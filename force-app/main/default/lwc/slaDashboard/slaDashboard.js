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
const JIRA_EXTRA_FIELDS = [
    { apiName: 'AVB_Status__c', label: 'Jira Status' },
    { apiName: 'AVB_Priority__c', label: 'Jira Priority' },
    { apiName: 'AVB_Fix_Versions__c', label: 'Jira Fix Version' },
    { apiName: 'AVB_Assignee__c', label: 'Jira Assignee' },
    { apiName: 'AVB_Reporter__c', label: 'Jira Reporter' },
    { apiName: 'AVB_Due_Date__c', label: 'Jira Due Date' },
    { apiName: 'AVB_Customers__c', label: 'Jira Customers' },
    { apiName: 'AVB_Base_Cloud_Tools_Environment__c', label: 'Jira Environment' }
];

export default class SlaDashboard extends NavigationMixin(LightningElement) {
    @api pollingFrequency = 60;
    @api thresholdColor = '#ff0000';
    @api normalColor = '#000000';
    @api greenThreshold = 24;
    @api yellowThreshold = 12;
    @api orangeThreshold = 1;
    @api columnFields = 'CaseNumber:100, RT_Remaining:150, AT_Remaining:150, UoW_Remaining:150, Fx_Remaining:150, Subject, Priority';

    @track milestoneItems = [ 
        { id: 'Response Time', fullLabel: 'RT', shortLabel: 'RT', count: 0, tooltip: '', gauge: { hasData: false, red: {}, orange: {}, yellow: {}, green: {} } }, 
        { id: 'Analysis and Timeline', fullLabel: 'A&T', shortLabel: 'A&T', count: 0, tooltip: '', gauge: { hasData: false, red: {}, orange: {}, yellow: {}, green: {} } }, 
        { id: 'Update or Workaround', fullLabel: 'UoW', shortLabel: 'UoW', count: 0, tooltip: '', gauge: { hasData: false, red: {}, orange: {}, yellow: {}, green: {} } }, 
        { id: 'Fix Resolution', fullLabel: 'Fx', shortLabel: 'Fx', count: 0, tooltip: '', gauge: { hasData: false, red: {}, orange: {}, yellow: {}, green: {} } } 
    ];

    @track milestoneList = []; @track isPriorityMode = false; @track isModalOpen = false; @track modalTitle = ''; @track modalData = []; @track columns = [];
    @track sortedBy = ''; @track sortedDirection = 'asc'; @track searchTerm = ''; @track priorityFilter = []; @track hasJiraFilter = false;
    @track isExportModalOpen = false; @track selectableFields = [];
    isLoadingModal = false; isLoadingMore = false; isSearching = false; offset = 0; limit = 50; lastRequestId = 0; pollingTimeout; isPollingEnabled = false; currentDashboardId; isMoreDataAvailable = true;

    @wire(EnclosingTabId) enclosingTabId;
    @wire(getObjectInfo, { objectApiName: CASE_OBJECT }) caseInfo;

    connectedCallback() { this.fetchData(); this.startPolling(); if (onTabFocused) { onTabFocused((event) => { const tid = this.enclosingTabId?.data; if (!tid || event.tabId === tid) { this.fetchData(); this.startPolling(); } else { this.stopPolling(); } }); } }
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
        this.modalData = []; this.offset = 0; this.isModalOpen = true; this.buildColumns(); this.loadModalData();
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
            const mandatorySLAs = ['RT_Remaining:150', 'AT_Remaining:150', 'UoW_Remaining:150', 'Fx_Remaining:150'];
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
                else if (isSLA) style = 'width: 150px; min-width: 150px;'; 
                else if (fieldName === 'CaseNumber') style = 'width: 100px; min-width: 100px;';

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

    loadModalData() {
        if (!this.columns || this.columns.length === 0) this.buildColumns();
        const rid = ++this.lastRequestId; const off = this.offset;
        if (off === 0) this.isLoadingModal = true; else this.isLoadingMore = true;
        
        const fieldsToQuery = this.columnFields.split(',').map(f => f.trim().split(':')[0].trim());
        if (!fieldsToQuery.includes('Priority')) fieldsToQuery.push('Priority');
        const realFields = fieldsToQuery.filter(f => !['RT_Remaining', 'AT_Remaining', 'UoW_Remaining', 'Fx_Remaining'].includes(f));

        getCaseList({ dashboardId: this.currentDashboardId, accountId: null, fields: realFields, sortField: this.sortedBy.replaceAll(DOT_SEP, '.'), sortOrder: this.sortedDirection, searchTerm: this.searchTerm, offset: off, onlyMine: false, priorityFilter: this.priorityFilter, limitCount: this.limit, advancedField: '', advancedValue: '', hasJira: this.hasJiraFilter, statusFilter: [], unresponsiveFilter: [], onlyCountFirstSLA: this.isPriorityMode })
        .then(data => {
            if (rid !== this.lastRequestId) return;
            
            const flattened = this.flattenData(data).map(c => {
                try {
                    let slaColorClass = '';
                    let sv = { RT_Remaining: '/', AT_Remaining: '/', UoW_Remaining: '/', Fx_Remaining: '/' };
                    const ms = c.CaseMilestones || (c.CaseMilestones ? c.CaseMilestones.records : []);
                    const mlist = Array.isArray(ms) ? ms : (ms.records || []);
                    mlist.forEach(m => {
                        const mt = m.MilestoneType;
                        if (mt) {
                            let s = '/';
                            const completed = m.IsCompleted === true || m.isCompleted === true;
                            const violated = m.IsViolated === true || m.isViolated === true;
                            const target = m.TargetDate || m.targetDate;
                            if (completed) s = violated ? 'Violated' : 'Completed';
                            else if (target) s = this.calculateTimeRemaining(target);
                            const r = (v) => v === 'Violated' ? 4 : (v === '/' ? 0 : (v === 'Completed' ? 1 : 3));
                            const upd = (o, n) => r(n) >= r(o) ? n : o;
                            if (mt.Name === 'Response Time') sv.RT_Remaining = upd(sv.RT_Remaining, s);
                            else if (mt.Name === 'Analysis and Timeline') sv.AT_Remaining = upd(sv.AT_Remaining, s);
                            else if (mt.Name === 'Update or Workaround') sv.UoW_Remaining = upd(sv.UoW_Remaining, s);
                            else if (mt.Name === 'Fix Resolution') sv.Fx_Remaining = upd(sv.Fx_Remaining, s);

                            if (mt.Name === this.currentDashboardId) {
                                if (violated) {
                                    slaColorClass = 'sla-red';
                                } else if (target && !completed) {
                                    const now = new Date();
                                    const tgt = new Date(target);
                                    const diffMs = tgt - now;
                                    const h = diffMs / 36e5;
                                    if (h > this.greenThreshold) slaColorClass = 'sla-green';
                                    else if (h > this.yellowThreshold) slaColorClass = 'sla-yellow';
                                    else if (h > this.orangeThreshold) slaColorClass = 'sla-orange';
                                    else slaColorClass = 'sla-red';
                                }
                            }
                        }
                    });
                    
                    let rc = 'table-row ' + (slaColorClass ? slaColorClass : ('priority-' + (c.Priority ? c.Priority.toLowerCase() : 'normal')));
                    
                    // Assign SLA values to row object for sorting
                    c['RT_Remaining'] = sv.RT_Remaining;
                    c['AT_Remaining'] = sv.AT_Remaining;
                    c['UoW_Remaining'] = sv.UoW_Remaining;
                    c['Fx_Remaining'] = sv.Fx_Remaining;

                    let jiraDetails = [];
                    const jd = c.Jira_Tickets__r;
                    const tickets = Array.isArray(jd) ? jd : (jd ? (jd.records || []) : []);
                    if (this.hasJiraFilter && tickets && tickets.length > 0) {
                        jiraDetails = tickets.map((j, index) => ({
                            id: j.Id, name: j.Name, url: `https://aviobook.atlassian.net/browse/${j.Name}`,
                            status: j.AVB_Status__c || '-', priority: j.AVB_Priority__c || '-', fixVersion: j.AVB_Fix_Versions__c || '-', assignee: j.AVB_Assignee__c || '-',
                            itemClass: index % 2 === 0 ? 'jira-item-even' : 'jira-item-odd'
                        }));
                    }
                    const cells = this.columns.map(col => {
                        const recordValue = sv[col.fieldName] !== undefined ? sv[col.fieldName] : c[col.fieldName];
                        let displayValue = recordValue;
                        const isJira = !!col.isJira;
                        
                        if (isJira) {
                             displayValue = tickets ? tickets.map(j => j.Name).join(', ') : '';
                             c[col.fieldName] = displayValue; // For sorting
                        } else if (displayValue && col.fieldName.toLowerCase().includes('date')) {
                            displayValue = this.formatDate(displayValue);
                        }
                        return { key: col.fieldName, value: displayValue, isUrl: col.type === 'button', isBoolean: col.type === 'boolean', isJira: isJira, checkboxClass: col.type === 'boolean' ? (recordValue ? 'custom-checkbox checked' : 'custom-checkbox') : '' };
                    });
                    return { ...c, rowClass: rc, cells: cells, jiraDetails: jiraDetails, hasJiraDetails: jiraDetails.length > 0, jiraKey: c.Id + '-jira' };
                } catch (err) {
                    console.error('Row mapping error', err);
                    return { ...c, rowClass: 'table-row', cells: [], hasJiraDetails: false };
                }
            });
            this.modalData = (off === 0 ? [] : this.modalData).concat(flattened);
            this.isMoreDataAvailable = data.length === this.limit;
        })
        .catch(e => this.handleError('Error', e)).finally(() => { if (rid === this.lastRequestId) { this.isLoadingModal = false; this.isLoadingMore = false; } });
    }

    calculateTimeRemaining(tstr) {
        if (!tstr) return '/'; const t = new Date(tstr), n = new Date(), dms = t - n, ad = Math.abs(dms);
        const d = Math.floor(ad / 864e5), h = Math.floor((ad % 864e5) / 36e5), m = Math.floor((ad % 36e5) / 6e4);
        let res = ''; if (d > 0) res += `${d}d `; if (h > 0 || d > 0) res += `${h}h `; res += `${m}m`;
        return dms < 0 ? `Overdue by ${res.trim()}` : res.trim();
    }
    get searchPlaceholder() { return `Filter ${this.modalData.length}${this.isMoreDataAvailable ? '+' : ''} cases...`; }
    
    handleResizeMouseDown(e) {
        e.preventDefault(); e.stopPropagation();
        const th = e.target.closest('th');
        this._resizeState = { startX: e.clientX, startWidth: th.offsetWidth, fieldName: e.target.dataset.col };
        this._mouseMoveHandler = (evt) => this.handleMouseMove(evt);
        this._mouseUpHandler = (evt) => this.handleMouseUp(evt);
        window.addEventListener('mousemove', this._mouseMoveHandler);
        window.addEventListener('mouseup', this._mouseUpHandler);
    }
    handleMouseMove(e) {
        if (!this._resizeState) return;
        const delta = e.clientX - this._resizeState.startX;
        const newWidth = Math.max(50, this._resizeState.startWidth + delta);
        this.columns = this.columns.map(c => c.fieldName === this._resizeState.fieldName ? { ...c, style: `width: ${newWidth}px; min-width: ${newWidth}px;` } : c);
    }
    handleMouseUp(e) {
        window.removeEventListener('mousemove', this._mouseMoveHandler);
        window.removeEventListener('mouseup', this._mouseUpHandler);
        this._resizeState = null;
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
    handleSearch(e) { this.searchTerm = e.target.value; this.offset = 0; this.modalData = []; this.loadModalData(); }
    handlePriorityQuickFilter(e) { const v = e.target.value; if (this.priorityFilter.includes(v)) this.priorityFilter = this.priorityFilter.filter(p => p !== v); else this.priorityFilter = [...this.priorityFilter, v]; this.offset = 0; this.loadModalData(); }
    handleHasJiraToggle() { this.hasJiraFilter = !this.hasJiraFilter; this.offset = 0; this.loadModalData(); }
    viewCase(e) { const id = e.currentTarget.dataset.id; try { openTab({ recordId: id, focus: true }); } catch (er) { this[NavigationMixin.Navigate]({ type: 'standard__recordPage', attributes: { recordId: id, actionName: 'view' } }); } }
    closeModal() { this.isModalOpen = false; }
    handleStopPropagation(e) { e.stopPropagation(); }
    handleTableScroll(e) { const t = e.target, b = t.scrollHeight - t.scrollTop - t.clientHeight; if (b < 50 && this.isMoreDataAvailable && !this.isLoadingModal && !this.isLoadingMore && !this.isSearching) { this.offset += this.limit; this.loadModalData(); } }
    openExportConfig() {
        const u = []; 
        const fields = this.columnFields.split(',');
        const uniqueFields = []; const seen = new Set();
        
        fields.forEach(f => {
            const rawField = f.split(':')[0].trim();
            const fieldName = rawField.replaceAll('.', DOT_SEP);
            if (!seen.has(rawField)) {
                seen.add(rawField);
                const col = this.columns.find(c => c.fieldName === fieldName || c.fieldName === rawField);
                u.push({ apiName: rawField, label: col ? col.label : rawField, selected: true });
            }
        });

        // Add Jira Extra Fields
        JIRA_EXTRA_FIELDS.forEach(extra => {
            if (!seen.has(extra.apiName)) {
                seen.add(extra.apiName);
                u.push({ 
                    apiName: extra.apiName, 
                    label: extra.label, 
                    selected: this.hasJiraFilter 
                });
            }
        });

        this.selectableFields = u; this.isExportModalOpen = true; 
    }
    closeExportModal() { this.isExportModalOpen = false; }
    handleFieldToggle(e) { this.selectableFields = this.selectableFields.map(f => f.apiName === e.target.dataset.id ? { ...f, selected: e.target.checked } : f); }
    async downloadCSV() {
        const selectedFields = this.selectableFields.filter(f => f.selected);
        const jiraExtraApiNames = JIRA_EXTRA_FIELDS.map(j => j.apiName);
        const hasAnyJiraField = selectedFields.some(f => f.apiName === 'Jira' || jiraExtraApiNames.includes(f.apiName));
        
        let apiNames = selectedFields.map(f => f.apiName).filter(apiName => !jiraExtraApiNames.includes(apiName)); 
        if (hasAnyJiraField && !apiNames.includes('Jira')) apiNames.push('Jira');

        // Filter out virtual SLA fields for query
        apiNames = apiNames.filter(f => !['RT_Remaining', 'AT_Remaining', 'UoW_Remaining', 'Fx_Remaining'].includes(f));
        if (!apiNames.includes('Priority')) apiNames.push('Priority');

        this.closeExportModal();
        try {
            const data = await getCaseList({ 
                dashboardId: this.currentDashboardId, accountId: null, fields: apiNames, limitCount: 1000,
                searchTerm: this.searchTerm, priorityFilter: this.priorityFilter, onlyMine: false,
                sortField: this.sortedBy.replaceAll(DOT_SEP, '.'), sortOrder: this.sortedDirection,
                advancedField: '', advancedValue: '', hasJira: this.hasJiraFilter,
                statusFilter: [], unresponsiveFilter: [], onlyCountFirstSLA: this.isPriorityMode
            });
            const flattened = this.flattenData(data);
            
            // Build Header Row
            let headerRow = 'Case Number,Link';
            selectedFields.forEach(f => { headerRow += `,"${f.label}"`; });
            let csv = headerRow + '\n';
            
            flattened.forEach(row => {
                let sv = { RT_Remaining: '/', AT_Remaining: '/', UoW_Remaining: '/', Fx_Remaining: '/' };
                const ms = row.CaseMilestones || (row.CaseMilestones ? row.CaseMilestones.records : []);
                const mlist = Array.isArray(ms) ? ms : (ms.records || []);
                mlist.forEach(m => {
                    const mt = m.MilestoneType;
                    if (mt) {
                        let s = '/';
                        const completed = m.IsCompleted === true || m.isCompleted === true;
                        const violated = m.IsViolated === true || m.isViolated === true;
                        const target = m.TargetDate || m.targetDate;
                        if (completed) s = violated ? 'Violated' : 'Completed';
                        else if (target) s = this.calculateTimeRemaining(target);
                        if (mt.Name === 'Response Time') sv.RT_Remaining = s;
                        else if (mt.Name === 'Analysis and Timeline') sv.AT_Remaining = s;
                        else if (mt.Name === 'Update or Workaround') sv.UoW_Remaining = s;
                        else if (mt.Name === 'Fix Resolution') sv.Fx_Remaining = s;
                    }
                });
                
                const caseLink = `${window.location.origin}/lightning/r/Case/${row.Id}/view`;
                const baseLinePart1 = `${row.CaseNumber},${caseLink}`;
                
                const jiraData = row['Jira_Tickets__r'];
                const tickets = hasAnyJiraField && Array.isArray(jiraData) ? jiraData : (jiraData ? jiraData.records : []);
                const rowsToOutput = (tickets && tickets.length > 0) ? tickets : [null];

                rowsToOutput.forEach(ticket => {
                    let line = baseLinePart1;
                    selectedFields.forEach(f => { 
                        if (f.apiName === 'Jira') {
                            line += `,"${ticket ? ticket.Name : ''}"`;
                        } else if (jiraExtraApiNames.includes(f.apiName)) {
                            if (ticket) {
                                let val = ticket[f.apiName];
                                if (f.apiName.includes('Date')) val = this.formatDate(val);
                                line += `,"${val || ''}"`;
                            } else {
                                line += ',""';
                            }
                        } else {
                            let val = sv[f.apiName] !== undefined ? sv[f.apiName] : row[f.apiName];
                            let k = f.apiName.includes('.') ? f.apiName.replaceAll('.', DOT_SEP) : f.apiName;
                            if (val === undefined && !sv[f.apiName]) val = row[k];
                            line += ',"'+ String(val || '').replace(/"/g, '""') + '"'; 
                        }
                    });
                    csv += line + '\n';
                });
            });
            const lnk = document.createElement('a'); lnk.href = 'data:text/csv;base64,' + window.btoa(unescape(encodeURIComponent(csv))); lnk.download = 'SLA_Export.csv'; lnk.click();
        } catch (err) { this.handleError('Export Failed', err); }
    }

    formatDate(ds) { if (!ds) return ''; const d = new Date(ds); if (isNaN(d.getTime())) return ds; const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; }
    get priorityFilterUrgent() { return this.priorityFilter.includes('Urgent') ? 'brand' : 'neutral'; }
    get priorityFilterHigh() { return this.priorityFilter.includes('High') ? 'brand' : 'neutral'; }
    get priorityFilterNormal() { return this.priorityFilter.includes('Normal') ? 'brand' : 'neutral'; }
    get priorityFilterLow() { return this.priorityFilter.includes('Low') ? 'brand' : 'neutral'; }
    get hasJiraBtnVariant() { return this.hasJiraFilter ? 'brand' : 'neutral'; }
    get sortIcon() { return this.sortedDirection === 'asc' ? 'utility:arrowup' : 'utility:arrowdown'; }
    handleError(t, e) { this.dispatchEvent(new ShowToastEvent({ title: t, message: e.body?.message || e.message, variant: 'error' })); }
}
