import { LightningElement, api, track, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { getObjectInfo } from 'lightning/uiObjectInfoApi';
import CASE_OBJECT from '@salesforce/schema/Case';
import { EnclosingTabId, openTab, onTabFocused } from 'lightning/platformWorkspaceApi';
import getDashboardData from '@salesforce/apex/SLADashboardController.getDashboardData';
import getCaseList from '@salesforce/apex/SLADashboardController.getCaseList';

const DOT_SEP = '__DOT__';
const SLA_COLUMNS_MAP = { 'Response Time': 'RT_Remaining', 'Analysis and Timeline': 'AT_Remaining', 'Update or Workaround': 'UoW_Remaining', 'Fix Resolution': 'Fx_Remaining' };

export default class SlaDashboard extends NavigationMixin(LightningElement) {
    @api pollingFrequency = 60;
    @api thresholdColor = '#ff0000';
    @api normalColor = '#000000';
    @api greenThreshold = 24;
    @api yellowThreshold = 12;
    @api orangeThreshold = 1;
    @api columnFields = 'CaseNumber:100, RT_Remaining:120, AT_Remaining:120, UoW_Remaining:120, Fx_Remaining:120, Subject, Priority';

    @track milestoneItems = [ 
        { id: 'Response Time', fullLabel: 'RT', shortLabel: 'RT', count: 0, tooltip: '', gauge: { hasData: false, red: {}, orange: {}, yellow: {}, green: {} } }, 
        { id: 'Analysis and Timeline', fullLabel: 'A&T', shortLabel: 'A&T', count: 0, tooltip: '', gauge: { hasData: false, red: {}, orange: {}, yellow: {}, green: {} } }, 
        { id: 'Update or Workaround', fullLabel: 'UoW', shortLabel: 'UoW', count: 0, tooltip: '', gauge: { hasData: false, red: {}, orange: {}, yellow: {}, green: {} } }, 
        { id: 'Fix Resolution', fullLabel: 'Fx', shortLabel: 'Fx', count: 0, tooltip: '', gauge: { hasData: false, red: {}, orange: {}, yellow: {}, green: {} } } 
    ];

    @track milestoneList = []; @track isPriorityMode = false; @track isModalOpen = false; @track modalTitle = ''; @track modalData = []; @track stoppedData = []; @track columns = [];
    @track sortedBy = ''; @track sortedDirection = 'asc';
    isLoadingModal = false; isLoadingMore = false; offset = 0; limit = 50; 
    isLoadingStopped = false; stoppedOffset = 0; isMoreStoppedAvailable = true;
    lastRequestId = 0; pollingTimeout; isPollingEnabled = false; currentDashboardId; isMoreDataAvailable = true;

    @wire(EnclosingTabId) enclosingTabId;
    @wire(getObjectInfo, { objectApiName: CASE_OBJECT }) caseInfo;

    connectedCallback() { this.fetchData(); this.startPolling(); if (onTabFocused) { onTabFocused((event) => { const tid = this.enclosingTabId?.data; if (!tid || event.tabId === tid) { this.fetchData(); this.startPolling(); } else { this.stopPolling(); } }); } }
    disconnectedCallback() {
        this.stopPolling();
        if (this._escapeHandler) {
            window.removeEventListener('keydown', this._escapeHandler);
        }
    }
    startPolling() { this.stopPolling(); this.isPollingEnabled = true; this.pollingTimeout = setTimeout(() => this._performPoll(), (this.pollingFrequency || 60) * 1000); }
    stopPolling() { this.isPollingEnabled = false; if (this.pollingTimeout) clearTimeout(this.pollingTimeout); }
    _performPoll() { if (!this.isPollingEnabled) return; this.fetchData().finally(() => { if (this.isPollingEnabled) this.pollingTimeout = setTimeout(() => this._performPoll(), (this.pollingFrequency || 60) * 1000); }); }

    fetchData() { return getDashboardData({ accountId: null }).then(result => { if (result) { this.milestoneList = result.milestoneList || []; this.computeMilestoneCounts(); } }).catch(e => this.handleError('Load Error', e)); }
    handleToggleSLA(e) { this.isPriorityMode = e.target.checked; this.computeMilestoneCounts(); }
    
    computeMilestoneCounts() {
        const sm = {}; 
        this.milestoneItems.forEach(i => sm[i.id] = { 
            count: 0, 
            priMap: { Urgent: 0, High: 0, Normal: 0, Low: 0 },
            buckets: { green: 0, yellow: 0, orange: 0, red: 0 }
        });
        
        let lastId = null;
        this.milestoneList.forEach(m => {
            if (!this.isPriorityMode || m.caseId !== lastId) {
                if (sm[m.mName]) { 
                    sm[m.mName].count++; 
                    let p = m.priority || 'Normal'; 
                    if (sm[m.mName].priMap[p] !== undefined) sm[m.mName].priMap[p]++;
                    
                    let hoursLeft = -999;
                    if (m.targetDate) {
                        const now = new Date();
                        const tgt = new Date(m.targetDate);
                        const diffMs = tgt - now;
                        hoursLeft = diffMs / 36e5; 
                    }
                    
                    if (hoursLeft > this.greenThreshold) sm[m.mName].buckets.green++;
                    else if (hoursLeft > this.yellowThreshold) sm[m.mName].buckets.yellow++;
                    else if (hoursLeft > this.orangeThreshold) sm[m.mName].buckets.orange++;
                    else sm[m.mName].buckets.red++; 
                }
                lastId = m.caseId;
            }
        });

        this.milestoneItems = this.milestoneItems.map(i => {
            const s = sm[i.id]; 
            const tip = `Danger: ${s.buckets.red} | Warning: ${s.buckets.orange} | Attention: ${s.buckets.yellow} | OK: ${s.buckets.green}`;
            const total = s.count > 0 ? s.count : 1; 
            const pct = (val) => (val / total) * 100;
            const rVal = pct(s.buckets.red);
            const oVal = pct(s.buckets.orange);
            const yVal = pct(s.buckets.yellow);
            const gVal = pct(s.buckets.green);
            const pRed = `${rVal} ${100 - rVal}`;
            const oRed = 25;
            const pOrg = `${oVal} ${100 - oVal}`;
            const oOrg = 25 - rVal;
            const pYel = `${yVal} ${100 - yVal}`;
            const oYel = 25 - rVal - oVal;
            const pGrn = `${gVal} ${100 - gVal}`;
            const oGrn = 25 - rVal - oVal - yVal;

            return { 
                ...i, 
                count: s.count, 
                tooltip: tip, 
                gauge: {
                    red: { array: pRed, offset: oRed },
                    orange: { array: pOrg, offset: oOrg },
                    yellow: { array: pYel, offset: oYel },
                    green: { array: pGrn, offset: oGrn },
                    hasData: s.count > 0
                }
            };
        });
    }

    handleItemClick(e) {
        const id = e.currentTarget.dataset.id; this.currentDashboardId = id; this.modalTitle = id + ' Overview';
        this.sortedBy = SLA_COLUMNS_MAP[id]; this.sortedDirection = 'asc';
        this.modalData = []; this.stoppedData = [];
        this.offset = 0; this.stoppedOffset = 0;
        this.isModalOpen = true; 

        // Add ESC listener
        this._escapeHandler = (event) => {
            if (event.key === 'Escape') {
                this.closeModal();
            }
        };
        window.addEventListener('keydown', this._escapeHandler);

        this.buildColumns(); this.loadModalData();
    }

    buildColumns() {
        try {
            const cols = [];
            let fieldList = this.columnFields.split(',').map(f => f.trim()).filter(f => f);
            
            // Ensure CaseNumber is first
            const cnIndex = fieldList.findIndex(f => f.startsWith('CaseNumber'));
            if (cnIndex > -1) {
                const item = fieldList.splice(cnIndex, 1)[0];
                fieldList.unshift(item);
            } else {
                fieldList.unshift('CaseNumber:100');
            }

            // Enforce SLA columns at index 1
            const mandatorySLAs = ['RT_Remaining:120', 'AT_Remaining:120', 'UoW_Remaining:120', 'Fx_Remaining:120'];
            // Remove existing SLAs to avoid duplicates
            fieldList = fieldList.filter(f => !mandatorySLAs.some(m => f.startsWith(m.split(':')[0])));
            // Insert at index 1
            fieldList.splice(1, 0, ...mandatorySLAs);
            
            fieldList.forEach(f => {
                const parts = f.split(':');
                let fieldName = parts[0].trim();
                const width = parts.length > 1 ? parts[1].trim() : null;
                
                const isSLA = ['RT_Remaining', 'AT_Remaining', 'UoW_Remaining', 'Fx_Remaining'].includes(fieldName);
                let isJira = false;

                let label = fieldName;
                if (fieldName.toLowerCase() === 'jira') {
                    label = 'Jira Tickets';
                    isJira = true;
                } else if (isSLA) {
                    if (fieldName === 'RT_Remaining') label = 'RT Remaining';
                    else if (fieldName === 'AT_Remaining') label = 'A&T Remaining';
                    else if (fieldName === 'UoW_Remaining') label = 'UoW Remaining';
                    else if (fieldName === 'Fx_Remaining') label = 'Fx Remaining';
                } else if (fieldName === 'CaseNumber') {
                    label = 'Case Number';
                } else if (this.caseInfo && this.caseInfo.data && this.caseInfo.data.fields[fieldName]) {
                    label = this.caseInfo.data.fields[fieldName].label;
                } else if (fieldName.includes('.')) {
                    fieldName = fieldName.split('.').join(DOT_SEP);
                    const originalParts = f.split(':')[0].trim().split('.');
                    label = originalParts[0] + ' ' + originalParts[1];
                }

                let style = '';
                if (width) style = `width: ${width}px; min-width: ${width}px;`;
                else if (isSLA) style = 'width: 120px; min-width: 120px;'; 
                else if (fieldName === 'CaseNumber') style = 'width: 100px; min-width: 100px;';
                else style = 'min-width: 150px;';

                let type = 'text';
                if (fieldName === 'CaseNumber') type = 'button';
                else if (this.caseInfo?.data?.fields[fieldName]?.dataType === 'Boolean') type = 'boolean';
                else if (fieldName === 'AVB_Warn_Unresponsive_Customer__c') type = 'boolean';

                const isSorted = this.sortedBy === fieldName;
                let headerClass = isSorted ? 'is-sorted' : 'is-sortable';
                if (isJira) headerClass = '';

                cols.push({
                    label: label,
                    fieldName: fieldName,
                    type: type,
                    style: style,
                    isJira: isJira,
                    isSortable: !isJira,
                    headerClass: headerClass,
                    showSortIcon: isSorted
                });
            });
            this.columns = cols;
        } catch (e) {
            console.error('buildColumns error', e);
            this.columns = [
                { label: 'Case Number', fieldName: 'CaseNumber', type: 'button', style: 'width: 100px;' },
                { label: 'Subject', fieldName: 'Subject', type: 'text' }
            ];
        }
    }

    flattenData(data) {
        const recurse = (obj, prefix = '', res = {}) => {
            if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
                Object.keys(obj).forEach(key => {
                    const val = obj[key];
                    const newKey = prefix ? `${prefix}${DOT_SEP}${key}` : key;
                    res[newKey] = val;
                    if (val && typeof val === 'object' && !Array.isArray(val)) {
                        recurse(val, newKey, res);
                    }
                });
            }
            return res;
        };
        return data.map(record => {
            try {
                const plain = JSON.parse(JSON.stringify(record));
                return recurse(plain);
            } catch (e) {
                return record;
            }
        });
    }

    processRowData(data) {
        return this.flattenData(data).map(c => {
            try {
                let sv = { RT_Remaining: '/', AT_Remaining: '/', UoW_Remaining: '/', Fx_Remaining: '/' };
                let slaStatusMap = {};

                const ms = c.CaseMilestones || (c.CaseMilestones ? c.CaseMilestones.records : []);
                const mlist = Array.isArray(ms) ? ms : (ms.records || []);
                
                mlist.forEach(m => {
                    const mt = m.MilestoneType;
                    if (mt) {
                        let s = '/';
                        let cellClass = '';
                        const completed = m.IsCompleted === true || m.isCompleted === true;
                        const violated = m.IsViolated === true || m.isViolated === true;
                        const target = m.TargetDate || m.targetDate;
                        
                        if (completed) {
                            s = violated ? 'Violated' : 'Completed';
                            if (violated) cellClass = 'cell-sla-red';
                        } else if (target) {
                            s = this.calculateTimeRemaining(target);
                            const now = new Date();
                            const tgt = new Date(target);
                            const diffMs = tgt - now;
                            const h = diffMs / 36e5;
                            
                            if (h > this.greenThreshold) cellClass = 'cell-sla-green';
                            else if (h > this.yellowThreshold) cellClass = 'cell-sla-yellow';
                            else if (h > this.orangeThreshold) cellClass = 'cell-sla-orange';
                            else cellClass = 'cell-sla-red';
                        }

                        const r = (v) => v === 'Violated' ? 4 : (v === '/' ? 0 : (v === 'Completed' ? 1 : 3));
                        const upd = (o, n) => r(n) >= r(o) ? n : o;
                        
                        if (mt.Name === 'Response Time') { sv.RT_Remaining = upd(sv.RT_Remaining, s); if (cellClass) slaStatusMap['RT_Remaining'] = cellClass; }
                        else if (mt.Name === 'Analysis and Timeline') { sv.AT_Remaining = upd(sv.AT_Remaining, s); if (cellClass) slaStatusMap['AT_Remaining'] = cellClass; }
                        else if (mt.Name === 'Update or Workaround') { sv.UoW_Remaining = upd(sv.UoW_Remaining, s); if (cellClass) slaStatusMap['UoW_Remaining'] = cellClass; }
                        else if (mt.Name === 'Fix Resolution') { sv.Fx_Remaining = upd(sv.Fx_Remaining, s); if (cellClass) slaStatusMap['Fx_Remaining'] = cellClass; }
                    }
                });
                
                let rc = 'table-row ' + ('priority-' + (c.Priority ? c.Priority.toLowerCase() : 'normal'));
                
                c['RT_Remaining'] = sv.RT_Remaining;
                c['AT_Remaining'] = sv.AT_Remaining;
                c['UoW_Remaining'] = sv.UoW_Remaining;
                c['Fx_Remaining'] = sv.Fx_Remaining;

                let jiraDetails = [];
                const cells = this.columns.map(col => {
                    const recordValue = sv[col.fieldName] !== undefined ? sv[col.fieldName] : c[col.fieldName];
                    let displayValue = recordValue;
                    const isJira = !!col.isJira;
                    
                    const cellSlaClass = slaStatusMap[col.fieldName] || '';

                    if (isJira) {
                            displayValue = ''; // Jira column content if needed
                            c[col.fieldName] = displayValue; 
                    } else if (displayValue && col.fieldName.toLowerCase().includes('date')) {
                        displayValue = this.formatDate(displayValue);
                    }
                    return { 
                        key: col.fieldName, 
                        value: displayValue, 
                        isUrl: col.type === 'button', 
                        isBoolean: col.type === 'boolean', 
                        isJira: isJira, 
                        checkboxClass: col.type === 'boolean' ? (recordValue ? 'custom-checkbox checked' : 'custom-checkbox') : '',
                        cellClass: cellSlaClass
                    };
                });
                return { ...c, rowClass: rc, cells: cells, jiraDetails: jiraDetails, hasJiraDetails: jiraDetails.length > 0, jiraKey: c.Id + '-jira' };
            } catch (err) {
                console.error('Row mapping error', err);
                return { ...c, rowClass: 'table-row', cells: [], hasJiraDetails: false };
            }
        });
    }

    loadModalData() {
        if (!this.columns || this.columns.length === 0) this.buildColumns();
        const rid = ++this.lastRequestId; 
        
        const fieldsToQuery = this.columnFields.split(',').map(f => f.trim().split(':')[0].trim());
        if (!fieldsToQuery.includes('Priority')) fieldsToQuery.push('Priority');
        const realFields = fieldsToQuery.filter(f => !['RT_Remaining', 'AT_Remaining', 'UoW_Remaining', 'Fx_Remaining'].includes(f));
        
        const commonParams = {
            dashboardId: this.currentDashboardId, accountId: null, fields: realFields, 
            sortField: this.sortedBy.replaceAll(DOT_SEP, '.'), sortOrder: this.sortedDirection, 
            searchTerm: '', onlyMine: false, priorityFilter: [], limitCount: this.limit, 
            advancedField: '', advancedValue: '', hasJira: false, statusFilter: [], 
            unresponsiveFilter: [], onlyCountFirstSLA: this.isPriorityMode
        };

        // Load Active Cases (isStopped = false)
        if (this.offset === 0) this.isLoadingModal = true; else this.isLoadingMore = true;
        
        getCaseList({ ...commonParams, offset: this.offset, isStopped: false })
        .then(data => {
            if (rid !== this.lastRequestId) return;
            const processed = this.processRowData(data);
            this.modalData = (this.offset === 0 ? [] : this.modalData).concat(processed);
            this.isMoreDataAvailable = data.length === this.limit;
        })
        .catch(e => this.handleError('Error', e))
        .finally(() => { if (rid === this.lastRequestId) { this.isLoadingModal = false; this.isLoadingMore = false; } });

        // Load Stopped Cases (isStopped = true)
        // Only load stopped cases if we are doing an initial load or if explicitly paging them
        // For simplicity, we'll auto-load them initially.
        if (this.stoppedOffset === 0) {
            this.isLoadingStopped = true;
            getCaseList({ ...commonParams, offset: this.stoppedOffset, isStopped: true })
            .then(data => {
                if (rid !== this.lastRequestId) return;
                const processed = this.processRowData(data);
                this.stoppedData = (this.stoppedOffset === 0 ? [] : this.stoppedData).concat(processed);
                this.isMoreStoppedAvailable = data.length === this.limit;
            })
            .catch(e => this.handleError('Error Stopped', e))
            .finally(() => { if (rid === this.lastRequestId) this.isLoadingStopped = false; });
        }
    }
    
    loadMoreStopped() {
        if (this.isLoadingStopped || !this.isMoreStoppedAvailable) return;
        this.isLoadingStopped = true;
        const fieldsToQuery = this.columnFields.split(',').map(f => f.trim().split(':')[0].trim());
        if (!fieldsToQuery.includes('Priority')) fieldsToQuery.push('Priority');
        const realFields = fieldsToQuery.filter(f => !['RT_Remaining', 'AT_Remaining', 'UoW_Remaining', 'Fx_Remaining'].includes(f));
        
        getCaseList({ 
            dashboardId: this.currentDashboardId, accountId: null, fields: realFields, 
            sortField: this.sortedBy.replaceAll(DOT_SEP, '.'), sortOrder: this.sortedDirection, 
            searchTerm: '', onlyMine: false, priorityFilter: [], limitCount: this.limit, 
            advancedField: '', advancedValue: '', hasJira: false, statusFilter: [], 
            unresponsiveFilter: [], onlyCountFirstSLA: this.isPriorityMode,
            offset: this.stoppedOffset, isStopped: true 
        })
        .then(data => {
            const processed = this.processRowData(data);
            this.stoppedData = this.stoppedData.concat(processed);
            this.isMoreStoppedAvailable = data.length === this.limit;
        })
        .catch(e => this.handleError('Error Stopped', e))
        .finally(() => { this.isLoadingStopped = false; });
    }

    calculateTimeRemaining(tstr) {
        if (!tstr) return '/'; const t = new Date(tstr), n = new Date(), dms = t - n, ad = Math.abs(dms);
        const d = Math.floor(ad / 864e5), h = Math.floor((ad % 864e5) / 36e5), m = Math.floor((ad % 36e5) / 6e4);
        let res = ''; if (d > 0) res += `${d}d `; if (h > 0 || d > 0) res += `${h}h `; res += `${m}m`;
        return dms < 0 ? `Overdue by ${res.trim()}` : res.trim();
    }
    
    handleResizeMouseDown(e) {
        e.preventDefault();
        e.stopPropagation(); // Prevent sorting
        
        const th = e.target.closest('th');
        if (!th) return;

        const startX = e.pageX;
        const startWidth = th.getBoundingClientRect().width;
        const fieldName = e.target.dataset.col;

        this._resizeState = {
            startX,
            startWidth,
            fieldName,
            thElement: th
        };

        // Attach listeners to window to capture movement outside the element
        this._mouseMoveHandler = this.handleMouseMove.bind(this);
        this._mouseUpHandler = this.handleMouseUp.bind(this);
        
        window.addEventListener('mousemove', this._mouseMoveHandler);
        window.addEventListener('mouseup', this._mouseUpHandler);
    }

    handleMouseMove(e) {
        if (!this._resizeState) return;
        
        e.preventDefault(); // Prevent text selection
        
        const delta = e.pageX - this._resizeState.startX;
        const newWidth = Math.max(50, this._resizeState.startWidth + delta); // Min width 50px
        
        this._resizeState.currentWidth = newWidth;
        
        // Direct DOM update for performance
        if (this._resizeState.thElement) {
            this._resizeState.thElement.style.width = `${newWidth}px`;
            // Also set min-width to force the table to respect it
            this._resizeState.thElement.style.minWidth = `${newWidth}px`; 
        }
    }

    handleMouseUp(e) {
        if (!this._resizeState) return;

        window.removeEventListener('mousemove', this._mouseMoveHandler);
        window.removeEventListener('mouseup', this._mouseUpHandler);
        
        const { fieldName, currentWidth } = this._resizeState;

        if (currentWidth) {
            // Commit the new width to the state so it persists across re-renders (like sorting)
            this.columns = this.columns.map(col => {
                if (col.fieldName === fieldName) {
                    return { ...col, style: `width: ${currentWidth}px; min-width: ${currentWidth}px;` };
                }
                return col;
            });
        }

        this._resizeState = null;
        this._mouseMoveHandler = null;
        this._mouseUpHandler = null;
    }

    handleSort(e) { 
        if (e.target.classList.contains('resize-handle')) return;
        const f = e.currentTarget.dataset.id; 
        if (this.sortedBy === f) {
            this.sortedDirection = this.sortedDirection === 'asc' ? 'desc' : 'asc'; 
        } else {
            this.sortedBy = f;
            this.sortedDirection = 'asc'; 
        } 

        // Client-side sorting logic
        const data = [...this.modalData];
        const reverse = this.sortedDirection === 'desc' ? -1 : 1;

        data.sort((a, b) => {
            let valA = a[f];
            let valB = b[f];

            const isSLAField = f.includes('_Remaining');
            
            if (isSLAField) {
                const getSlaScore = (v) => {
                    if (v === 'Violated') return -1000000;
                    if (v === '/' || !v) return 1000000;
                    if (v === 'Completed') return 2000000;
                    if (v.includes('Overdue by')) {
                        const parts = v.replace('Overdue by ', '').split(' ');
                        let mins = 0;
                        parts.forEach(p => {
                            if (p.endsWith('d')) mins += parseInt(p) * 1440;
                            else if (p.endsWith('h')) mins += parseInt(p) * 60;
                            else if (p.endsWith('m')) mins += parseInt(p);
                        });
                        return -mins;
                    }
                    const parts = v.split(' ');
                    let mins = 0;
                    parts.forEach(p => {
                        if (p.endsWith('d')) mins += parseInt(p) * 1440;
                        else if (p.endsWith('h')) mins += parseInt(p) * 60;
                        else if (p.endsWith('m')) mins += parseInt(p);
                    });
                    return mins;
                };
                valA = getSlaScore(valA);
                valB = getSlaScore(valB);
            }

            if (valA === undefined || valA === null) valA = '';
            if (valB === undefined || valB === null) valB = '';
            
            if (typeof valA === 'string') valA = valA.toLowerCase();
            if (typeof valB === 'string') valB = valB.toLowerCase();

            if (valA === '' && valB !== '') return -1 * reverse;
            if (valA !== '' && valB === '') return 1 * reverse;

            if (valA < valB) return -1 * reverse;
            if (valA > valB) return 1 * reverse;
            return 0;
        });

        this.modalData = data;
        this.buildColumns(); 
    }
    viewCase(e) { const id = e.currentTarget.dataset.id; try { openTab({ recordId: id, focus: true }); } catch (er) { this[NavigationMixin.Navigate]({ type: 'standard__recordPage', attributes: { recordId: id, actionName: 'view' } }); } }
    closeModal() { 
        this.isModalOpen = false; 
        if (this._escapeHandler) {
            window.removeEventListener('keydown', this._escapeHandler);
            this._escapeHandler = null;
        }
    }
    handleStopPropagation(e) { e.stopPropagation(); }
    handleTableScroll(e) { const t = e.target, b = t.scrollHeight - t.scrollTop - t.clientHeight; if (b < 50 && this.isMoreDataAvailable && !this.isLoadingModal && !this.isLoadingMore) { this.offset += this.limit; this.loadModalData(); } }
    
    formatDate(ds) { if (!ds) return ''; const d = new Date(ds); if (isNaN(d.getTime())) return ds; const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; }
    
    get activeCasesTitle() { return `Active Cases (${this.modalData.length}${this.isMoreDataAvailable ? '+' : ''})`; }
    get stoppedCasesTitle() { return `Cases Waiting for Customer (${this.stoppedData.length}${this.isMoreStoppedAvailable ? '+' : ''})`; }

    get sortIcon() { return this.sortedDirection === 'asc' ? 'utility:arrowup' : 'utility:arrowdown'; }
    handleError(t, e) { this.dispatchEvent(new ShowToastEvent({ title: t, message: e.body?.message || e.message, variant: 'error' })); }
}