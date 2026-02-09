import { LightningElement, api, track, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { EnclosingTabId, openTab, onTabFocused } from 'lightning/platformWorkspaceApi';
import getDashboardData from '@salesforce/apex/SLADashboardController.getDashboardData';
import getCaseList from '@salesforce/apex/SLADashboardController.getCaseList';

const DOT_SEP = '__DOT__';
const SLA_COLUMNS_MAP = { 'Response Time': 'RT_Remaining', 'Analysis and Timeline': 'AT_Remaining', 'Update or Workaround': 'UoW_Remaining', 'Fix Resolution': 'Fx_Remaining' };

export default class SlaDashboard extends NavigationMixin(LightningElement) {
    @api pollingFrequency = 60;
    @api thresholdColor = '#ff0000';
    @api normalColor = '#000000';

    @track milestoneItems = [ 
        { id: 'Response Time', fullLabel: 'RT', shortLabel: 'RT', count: 0, tooltip: '', cssClass: 'count-wrapper' }, 
        { id: 'Analysis and Timeline', fullLabel: 'A&T', shortLabel: 'A&T', count: 0, tooltip: '', cssClass: 'count-wrapper' }, 
        { id: 'Update or Workaround', fullLabel: 'UoW', shortLabel: 'UoW', count: 0, tooltip: '', cssClass: 'count-wrapper' }, 
        { id: 'Fix Resolution', fullLabel: 'Fx', shortLabel: 'Fx', count: 0, tooltip: '', cssClass: 'count-wrapper' } 
    ];

    @track milestoneList = []; @track isPriorityMode = false; @track isModalOpen = false; @track modalTitle = ''; @track modalData = []; @track columns = [];
    @track sortedBy = ''; @track sortedDirection = 'asc'; @track searchTerm = ''; @track priorityFilter = []; @track hasJiraFilter = false;
    @track isExportModalOpen = false; @track selectableFields = [];
    isLoadingModal = false; isLoadingMore = false; isSearching = false; offset = 0; limit = 50; lastRequestId = 0; pollingTimeout; isPollingEnabled = false; currentDashboardId; isMoreDataAvailable = true;

    @wire(EnclosingTabId) enclosingTabId;

    connectedCallback() { this.fetchData(); this.startPolling(); if (onTabFocused) { onTabFocused((event) => { const tid = this.enclosingTabId?.data; if (!tid || event.tabId === tid) { this.fetchData(); this.startPolling(); } else { this.stopPolling(); } }); } }
    startPolling() { this.stopPolling(); this.isPollingEnabled = true; this.pollingTimeout = setTimeout(() => this._performPoll(), (this.pollingFrequency || 60) * 1000); }
    stopPolling() { this.isPollingEnabled = false; if (this.pollingTimeout) clearTimeout(this.pollingTimeout); }
    _performPoll() { if (!this.isPollingEnabled) return; this.fetchData().finally(() => { if (this.isPollingEnabled) this.pollingTimeout = setTimeout(() => this._performPoll(), (this.pollingFrequency || 60) * 1000); }); }

    fetchData() { return getDashboardData({ accountId: null }).then(result => { if (result) { this.milestoneList = result.milestoneList || []; this.computeMilestoneCounts(); } }).catch(e => this.handleError('Load Error', e)); }
    handleToggleSLA(e) { this.isPriorityMode = e.target.checked; this.computeMilestoneCounts(); }
    
    computeMilestoneCounts() {
        const sm = {}; this.milestoneItems.forEach(i => sm[i.id] = { count: 0, priMap: { Urgent: 0, High: 0, Normal: 0, Low: 0 } });
        let lastId = null;
        this.milestoneList.forEach(m => {
            if (!this.isPriorityMode || m.caseId !== lastId) {
                if (sm[m.mName]) { sm[m.mName].count++; let p = m.priority || 'Normal'; if (sm[m.mName].priMap[p] !== undefined) sm[m.mName].priMap[p]++; }
                lastId = m.caseId;
            }
        });
        this.milestoneItems = this.milestoneItems.map(i => {
            const s = sm[i.id]; const tip = `U: ${s.priMap.Urgent} | H: ${s.priMap.High} | N: ${s.priMap.Normal} | L: ${s.priMap.Low}`;
            let bg = 'transparent'; if (s.count > 0) { if (s.priMap.Urgent > 0) bg = 'rgba(229, 115, 115, 0.3)'; else if (s.priMap.High > 0) bg = 'rgba(255, 183, 77, 0.3)'; else bg = 'rgba(129, 199, 132, 0.3)'; }
            return { ...i, count: s.count, tooltip: tip, itemStyle: `color: ${s.count > 0 ? this.thresholdColor : this.normalColor}`, heatmapStyle: `background-color: ${bg}` };
        });
    }

    handleItemClick(e) {
        const id = e.currentTarget.dataset.id; this.currentDashboardId = id; this.modalTitle = id + ' Overview';
        this.sortedBy = SLA_COLUMNS_MAP[id]; this.sortedDirection = 'asc';
        this.modalData = []; this.offset = 0; this.isModalOpen = true; this.buildColumns(); this.loadModalData();
    }

    buildColumns() {
        const cols = [{ label: 'Case Number', fieldName: 'CaseNumber', type: 'button', style: 'width: 100px;', isSortable: true, headerClass: this.sortedBy === 'CaseNumber' ? 'is-sorted' : 'is-sortable', showSortIcon: this.sortedBy === 'CaseNumber' }];
        Object.keys(SLA_COLUMNS_MAP).forEach(k => { 
            const fn = SLA_COLUMNS_MAP[k]; const lb = k === 'Response Time' ? 'RT' : k === 'Analysis and Timeline' ? 'A&T' : k === 'Update or Workaround' ? 'UoW' : 'Fx';
            const s = this.sortedBy === fn; cols.push({ label: lb + ' Remaining', fieldName: fn, type: 'text', style: 'width: 150px;', isSortable: true, headerClass: s ? 'is-sorted' : 'is-sortable', showSortIcon: s }); 
        });
        cols.push({ label: 'Subject', fieldName: 'Subject', type: 'text', isSortable: true });
        cols.push({ label: 'Priority', fieldName: 'Priority', type: 'text', isSortable: true });
        this.columns = cols;
    }

    loadModalData() {
        const rid = ++this.lastRequestId; const off = this.offset;
        if (off === 0) this.isLoadingModal = true; else this.isLoadingMore = true;
        getCaseList({ dashboardId: this.currentDashboardId, accountId: null, fields: ['Subject','Priority'], sortField: this.sortedBy.replaceAll(DOT_SEP, '.'), sortOrder: this.sortedDirection, searchTerm: this.searchTerm, offset: off, onlyMine: false, priorityFilter: this.priorityFilter, limitCount: this.limit, advancedField: '', advancedValue: '', hasJira: this.hasJiraFilter, statusFilter: [], unresponsiveFilter: [], onlyCountFirstSLA: this.isPriorityMode })
        .then(data => {
            if (rid !== this.lastRequestId) return;
            this.isMoreDataAvailable = data.length === this.limit;
            this.modalData = (off === 0 ? [] : this.modalData).concat(data.map(c => {
                let rc = 'table-row priority-' + (c.Priority ? c.Priority.toLowerCase() : 'normal');
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
                    }
                });
                let jiraDetails = [];
                const jd = c.Jira_Tickets__r;
                const tickets = Array.isArray(jd) ? jd : (jd ? (jd.records || []) : []);
                if (tickets.length > 0) {
                    jiraDetails = tickets.map((j, index) => ({
                        id: j.Id, name: j.Name, url: `https://aviobook.atlassian.net/browse/${j.Name}`,
                        status: j.AVB_Status__c || '-', priority: j.AVB_Priority__c || '-', fixVersion: j.AVB_Fix_Versions__c || '-', assignee: j.AVB_Assignee__c || '-',
                        itemClass: index % 2 === 0 ? 'jira-item-even' : 'jira-item-odd'
                    }));
                }
                const cells = this.columns.map(col => {
                    let rv = sv[col.fieldName] !== undefined ? sv[col.fieldName] : c[col.fieldName];
                    if (rv && col.fieldName.toLowerCase().includes('date')) rv = this.formatDate(rv);
                    return { key: col.fieldName, value: rv, isUrl: col.type === 'button', isBoolean: col.type === 'boolean' };
                });
                return { ...c, rowClass: rc, cells: cells, jiraDetails: jiraDetails, hasJiraDetails: jiraDetails.length > 0, jiraKey: c.Id + '-jira' };
            }));
        }).catch(e => this.handleError('Error', e)).finally(() => { if (rid === this.lastRequestId) { this.isLoadingModal = false; this.isLoadingMore = false; } });
    }

    calculateTimeRemaining(tstr) {
        if (!tstr) return '/'; const t = new Date(tstr), n = new Date(), dms = t - n, ad = Math.abs(dms);
        const d = Math.floor(ad / 864e5), h = Math.floor((ad % 864e5) / 36e5), m = Math.floor((ad % 36e5) / 6e4);
        let res = ''; if (d > 0) res += `${d}d `; if (h > 0 || d > 0) res += `${h}h `; res += `${m}m`;
        return dms < 0 ? `Overdue by ${res.trim()}` : res.trim();
    }
    get searchPlaceholder() { return `Filter ${this.modalData.length}${this.isMoreDataAvailable ? '+' : ''} cases...`; }
    handleSort(e) { const f = e.currentTarget.dataset.id; if (this.sortedBy === f) this.sortedDirection = this.sortedDirection === 'asc' ? 'desc' : 'asc'; else { this.sortedBy = f; this.sortedDirection = 'asc'; } this.offset = 0; this.modalData = []; this.buildColumns(); this.loadModalData(); }
    handleSearch(e) { this.searchTerm = e.target.value; this.offset = 0; this.modalData = []; this.loadModalData(); }
    handlePriorityQuickFilter(e) { const v = e.target.value; if (this.priorityFilter.includes(v)) this.priorityFilter = this.priorityFilter.filter(p => p !== v); else this.priorityFilter = [...this.priorityFilter, v]; this.offset = 0; this.loadModalData(); }
    handleHasJiraToggle() { this.hasJiraFilter = !this.hasJiraFilter; this.offset = 0; this.loadModalData(); }
    viewCase(e) { const id = e.currentTarget.dataset.id; try { openTab({ recordId: id, focus: true }); } catch (er) { this[NavigationMixin.Navigate]({ type: 'standard__recordPage', attributes: { recordId: id, actionName: 'view' } }); } }
    closeModal() { this.isModalOpen = false; }
    handleStopPropagation(e) { e.stopPropagation(); }
    handleTableScroll(e) { const t = e.target, b = t.scrollHeight - t.scrollTop - t.clientHeight; if (b < 50 && this.isMoreDataAvailable && !this.isLoadingModal && !this.isLoadingMore && !this.isSearching) { this.offset += this.limit; this.loadModalData(); } }
    openExportConfig() {
        const u = []; const fields = ['CaseNumber','Subject','Priority','RT_Remaining','AT_Remaining','UoW_Remaining','Fx_Remaining'];
        fields.forEach(f => u.push({ apiName: f, label: f.replaceAll('_',' '), selected: true }));
        this.selectableFields = u; this.isExportModalOpen = true; 
    }
    closeExportModal() { this.isExportModalOpen = false; }
    handleFieldToggle(e) { this.selectableFields = this.selectableFields.map(f => f.apiName === e.target.dataset.id ? { ...f, selected: e.target.checked } : f); }
    async downloadCSV() {
        const sf = this.selectableFields.filter(f => f.selected); this.closeExportModal();
        try {
            let csv = 'Case Number,Subject,Priority,RT,AT,UOW,FX\n';
            this.modalData.forEach(r => {
                let line = `${r.CaseNumber},"${r.Subject}",${r.Priority}`;
                const cells = r.cells.filter(c => c.key.includes('Remaining'));
                cells.forEach(c => line += `,"${c.value}"`);
                csv += line + '\n';
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
