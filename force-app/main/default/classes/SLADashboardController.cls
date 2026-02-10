public without sharing class SLADashboardController {
    
    private static Map<String, List<String>> statusMap = new Map<String, List<String>>{
        'New' => new List<String>{'New'},
        'Open' => new List<String>{'Open', 'Working'},
        'Waiting for Customer' => new List<String>{'Waiting for Customer'},
        'On Hold' => new List<String>{'On Hold'},
        'Solved' => new List<String>{'Solved'},
        'ALL' => new List<String>{'New', 'Open', 'Working', 'Waiting for Customer', 'On Hold', 'Solved'}
    };
    
    private static List<String> MILESTONE_NAMES = new List<String>{
        'Response Time', 
        'Analysis and Timeline', 
        'Update or Workaround', 
        'Fix Resolution'
    };

    public class StatusSummary {
        @AuraEnabled public Integer count = 0;
        @AuraEnabled public String priorityTooltip = 'U: 0 | H: 0 | N: 0 | L: 0';
        @AuraEnabled public Map<String, Integer> priorityMap = new Map<String, Integer>{
            'Urgent' => 0, 'High' => 0, 'Normal' => 0, 'Low' => 0
        };
    }

    public class MilestoneInfo {
        @AuraEnabled public String mName;
        @AuraEnabled public String priority;
        @AuraEnabled public Id caseId;
        @AuraEnabled public Datetime targetDate;
        @AuraEnabled public String timeRemaining;
        @AuraEnabled public String timeSinceTarget;
    }

    public class DashboardData {
        @AuraEnabled public Map<String, StatusSummary> totals;
        @AuraEnabled public Map<String, StatusSummary> accountSpecific;
        @AuraEnabled public Map<String, StatusSummary> myTickets;
        @AuraEnabled public List<MilestoneInfo> milestoneList;
    }

    @AuraEnabled
    public static DashboardData getDashboardData(Id accountId) {
        DashboardData data = new DashboardData();
        data.totals = getSummaries(null, false);
        data.myTickets = getSummaries(null, true);
        data.accountSpecific = (accountId != null) ? getSummaries(accountId, false) : null;
        data.milestoneList = getMilestoneSummaries();
        return data;
    }

    private static List<MilestoneInfo> getMilestoneSummaries() {
        List<MilestoneInfo> results = new List<MilestoneInfo>();
        
        // We use CaseMilestone to find running milestones (IsCompleted = false) that are not stopped (Case.IsStopped = false)
        // GLOBAL query (no account filter). Exclude Solved/Closed cases.
        // We fetch ALL running milestones sorted by CaseId and TargetDate to allow frontend to filter/prioritize.
                String query = 'SELECT CaseId, MilestoneType.Name, Case.Priority, TargetDate, TimeRemainingInMins, TimeSinceTargetInMins ' +
                               'FROM CaseMilestone ' +
                               'WHERE IsCompleted = false ' + 
                               'AND Case.Status NOT IN (\'Solved\', \'Closed\') ' +
                               'AND MilestoneType.Name IN :MILESTONE_NAMES ' +
                               'ORDER BY CaseId, TargetDate ASC';
        
        for (SObject obj : Database.query(query, AccessLevel.USER_MODE)) {
            CaseMilestone cm = (CaseMilestone)obj;
            MilestoneInfo info = new MilestoneInfo();
            info.mName = cm.MilestoneType.Name;
            info.priority = cm.Case.Priority != null ? cm.Case.Priority : 'Normal';
            info.caseId = cm.CaseId;
            info.targetDate = cm.TargetDate;
            info.timeRemaining = (String)cm.get('TimeRemainingInMins');
            info.timeSinceTarget = (String)cm.get('TimeSinceTargetInMins');
            results.add(info);
        }
        
        return results;
    }

    private static Map<String, StatusSummary> getSummaries(Id accountId, Boolean onlyMine) {
        Map<String, StatusSummary> results = new Map<String, StatusSummary>{
            'New' => new StatusSummary(), 
            'Open' => new StatusSummary(), 
            'Waiting for Customer' => new StatusSummary(), 
            'On Hold' => new StatusSummary(),
            'Solved' => new StatusSummary(),
            'ALL' => new StatusSummary()
        };

        String query = 'SELECT Status, Priority, COUNT(Id) cnt FROM Case WHERE Status IN (\'New\', \'Open\', \'Working\', \'Waiting for Customer\', \'On Hold\', \'Solved\')';
        
        if (accountId != null) query += ' AND AccountId = :accountId';
        if (onlyMine) {
            Id currentUserId = UserInfo.getUserId();
            query += ' AND OwnerId = :currentUserId';
        }

        query += ' GROUP BY Status, Priority';

        for (AggregateResult ar : Database.query(query, AccessLevel.USER_MODE)) {
            String status = (String)ar.get('Status');
            String priority = (String)ar.get('Priority');
            Integer count = (Integer)ar.get('cnt');
            
            for (String dashboardId : statusMap.keySet()) {
                if (statusMap.get(dashboardId).contains(status)) {
                    StatusSummary summary = results.get(dashboardId);
                    summary.count += count;
                    if (summary.priorityMap.containsKey(priority)) {
                        summary.priorityMap.put(priority, summary.priorityMap.get(priority) + count);
                    }
                }
            }
        }

        for (StatusSummary summary : results.values()) {
            summary.priorityTooltip = 'U: ' + summary.priorityMap.get('Urgent') + 
                                     ' | H: ' + summary.priorityMap.get('High') + 
                                     ' | N: ' + summary.priorityMap.get('Normal') + 
                                     ' | L: ' + summary.priorityMap.get('Low');
        }

        return results;
    }

    @AuraEnabled
    public static List<Case> getCaseList(String dashboardId, Id accountId, List<String> fields, String sortField, String sortOrder, String searchTerm, Integer offset, String advancedField, String advancedValue, Boolean onlyMine, Integer limitCount, List<String> priorityFilter, Boolean hasJira, List<String> statusFilter, List<String> unresponsiveFilter, Boolean onlyCountFirstSLA, Boolean isStopped) {
        List<String> statuses = (statusFilter != null && !statusFilter.isEmpty()) ? statusFilter : statusMap.get(dashboardId);
        Boolean isMilestone = MILESTONE_NAMES.contains(dashboardId);
        if (statuses == null && !isMilestone) return new List<Case>();

        // Check if we are sorting by an SLA column
        Map<String, String> slaSortMap = new Map<String, String>{
            'RT_Remaining' => 'Response Time',
            'AT_Remaining' => 'Analysis and Timeline',
            'UoW_Remaining' => 'Update or Workaround',
            'Fx_Remaining' => 'Fix Resolution'
        };
        String targetMilestoneForSort = null;
        if (isMilestone) {
            if (String.isBlank(sortField)) targetMilestoneForSort = dashboardId;
            else if (slaSortMap.containsKey(sortField)) targetMilestoneForSort = slaSortMap.get(sortField);
        }

        Set<String> fieldSet = new Set<String>{'Id', 'CaseNumber'};
        Boolean includeJira = false;
        if (fields != null) {
            for (String f : fields) { 
                if (String.isNotBlank(f)) {
                    String rawF = f.trim().split(':')[0].trim();
                    String cleanF = rawF.replaceAll('[^a-zA-Z0-9._]', '');
                    if (cleanF.equalsIgnoreCase('Jira')) includeJira = true;
                    else fieldSet.add(cleanF); 
                }
            }
        }
        
        List<String> fieldList = new List<String>(fieldSet);
        if (includeJira) {
            fieldList.add('(SELECT Name, AVB_Status__c, AVB_Priority__c, AVB_Fix_Versions__c, AVB_Assignee__c, AVB_Reporter__c, AVB_Due_Date__c, AVB_Customers__c, AVB_Base_Cloud_Tools_Environment__c FROM Jira_Tickets__r)');
        }
        // Always include milestone data for status display in columns
        fieldList.add('(SELECT MilestoneType.Name, TargetDate, IsCompleted, IsViolated, TimeRemainingInMins, TimeSinceTargetInMins FROM CaseMilestones)');
        
        String fieldString = String.join(fieldList, ', ');
        Integer finalLimit = (limitCount != null && limitCount > 0) ? limitCount : 20;
        Integer finalOffset = (offset != null ? offset : 0);
        
        // Define stopped filter value
        Boolean stoppedVal = (isStopped != null ? isStopped : false);

        if (targetMilestoneForSort != null) {
            // Special SLA Sorting Logic
            String direction = (String.isNotBlank(sortOrder) && sortOrder.toLowerCase() == 'desc' ? 'DESC' : 'ASC');
            
            // Build sub-query filters for CaseMilestone to match the drill-down criteria
            String mQuery = 'SELECT CaseId FROM CaseMilestone WHERE IsCompleted = false ' +
                            'AND Case.IsStopped = :stoppedVal ' +
                            'AND Case.Status NOT IN (\'Solved\', \'Closed\') ' +
                            'AND MilestoneType.Name = :targetMilestoneForSort ';
            
            // Apply other Case-level filters to the milestone query
            if (accountId != null) mQuery += ' AND Case.AccountId = :accountId';
            if (onlyMine == true) { Id currentUserId = UserInfo.getUserId(); mQuery += ' AND Case.OwnerId = :currentUserId'; }
            if (priorityFilter != null && !priorityFilter.isEmpty()) mQuery += ' AND Case.Priority IN :priorityFilter';
            if (hasJira == true) mQuery += ' AND CaseId IN (SELECT AVB_Case__c FROM AVB_Jira_Ticket__c)';
            
            // Handle onlyCountFirstSLA priority filtering
            if (onlyCountFirstSLA == true) {
                Set<Id> winnerCaseIds = new Set<Id>();
                String winQuery = 'SELECT CaseId, MilestoneType.Name FROM CaseMilestone WHERE IsCompleted = false ' +
                                  'AND Case.IsStopped = :stoppedVal ' +
                                  'AND Case.Status NOT IN (\'Solved\', \'Closed\') AND MilestoneType.Name IN :MILESTONE_NAMES ORDER BY CaseId, TargetDate ASC';
                Id lastCaseId = null;
                for (SObject obj : Database.query(winQuery)) {
                    CaseMilestone cm = (CaseMilestone)obj;
                    if (cm.CaseId != lastCaseId) {
                        if (cm.MilestoneType.Name == targetMilestoneForSort) winnerCaseIds.add(cm.CaseId);
                        lastCaseId = cm.CaseId;
                    }
                }
                mQuery += ' AND CaseId IN :winnerCaseIds';
            }

            mQuery += ' ORDER BY TargetDate ' + direction + ' NULLS LAST LIMIT ' + finalLimit + ' OFFSET ' + finalOffset;
            
            List<Id> sortedCaseIds = new List<Id>();
            for (SObject obj : Database.query(mQuery)) { sortedCaseIds.add(((CaseMilestone)obj).CaseId); }
            if (sortedCaseIds.isEmpty()) return new List<Case>();

            // Query details for these specific cases
            String detailQuery = 'SELECT ' + fieldString + ' FROM Case WHERE Id IN :sortedCaseIds';
            Map<Id, Case> caseMap = new Map<Id, Case>((List<Case>)Database.query(detailQuery));
            
            List<Case> orderedResults = new List<Case>();
            for (Id cid : sortedCaseIds) { if (caseMap.containsKey(cid)) orderedResults.add(caseMap.get(cid)); }
            return orderedResults;
        }

        // Standard Sorting Logic
        String query = 'SELECT ' + fieldString + ' FROM Case WHERE ';
        List<String> whereClauses = new List<String>();
        if (statuses != null) whereClauses.add('Status IN :statuses');
        
        // Add IsStopped filter
        whereClauses.add('IsStopped = :stoppedVal');
        
        if (isMilestone) {
             if (onlyCountFirstSLA == true) {
                 Set<Id> validCaseIds = new Set<Id>();
                 String mQuery = 'SELECT CaseId, MilestoneType.Name FROM CaseMilestone WHERE IsCompleted = false ' +
                                 'AND Case.IsStopped = :stoppedVal ' +
                                 'AND Case.Status NOT IN (\'Solved\', \'Closed\') AND MilestoneType.Name IN :MILESTONE_NAMES ORDER BY CaseId, TargetDate ASC';
                 Id lastCaseId = null;
                 for (SObject obj : Database.query(mQuery)) {
                     CaseMilestone cm = (CaseMilestone)obj;
                     if (cm.CaseId != lastCaseId) { if (cm.MilestoneType.Name == dashboardId) validCaseIds.add(cm.CaseId); lastCaseId = cm.CaseId; }
                 }
                 whereClauses.add('Id IN :validCaseIds');
             } else {
                 whereClauses.add('Id IN (SELECT CaseId FROM CaseMilestone WHERE MilestoneType.Name = :dashboardId AND IsCompleted = false)');
                 whereClauses.add('Status NOT IN (\'Solved\', \'Closed\')');
             }
        }
        if (accountId != null) whereClauses.add('AccountId = :accountId');
        if (onlyMine == true) { Id currentUserId = UserInfo.getUserId(); whereClauses.add('OwnerId = :currentUserId'); }
        if (priorityFilter != null && !priorityFilter.isEmpty()) whereClauses.add('Priority IN :priorityFilter');
        if (unresponsiveFilter != null && unresponsiveFilter.size() == 1) { Boolean uv = Boolean.valueOf(unresponsiveFilter[0]); whereClauses.add('AVB_Warn_Unresponsive_Customer__c = :uv'); }
        if (hasJira == true) whereClauses.add('Id IN (SELECT AVB_Case__c FROM AVB_Jira_Ticket__c)');
        if (String.isNotBlank(advancedField) && String.isNotBlank(advancedValue)) { String sf = advancedField.replaceAll('[^a-zA-Z0-9._]', ''); String ev = '%' + String.escapeSingleQuotes(advancedValue.trim()) + '%'; whereClauses.add(sf + ' LIKE :ev'); }
        else if (String.isNotBlank(searchTerm)) {
            String es = '%' + String.escapeSingleQuotes(searchTerm) + '%'; List<String> sf = new List<String>();
            for (String f : fieldSet) { String fl = f.toLowerCase(); if (!fl.equals('id') && !fl.endsWith('id') && !fl.contains('date') && !fl.equals('isclosed') && !fl.equals('isdeleted') && !fl.equals('avb_warn_unresponsive_customer__c')) sf.add(f + ' LIKE :es'); }
            if (!sf.isEmpty()) whereClauses.add('(' + String.join(sf, ' OR ') + ')');
        }
        if (whereClauses.isEmpty()) query += ' IsClosed = false '; else query += String.join(whereClauses, ' AND ');
        if (String.isNotBlank(sortField)) { 
            String ss = sortField.replaceAll('[^a-zA-Z0-9._]', ''); 
            String dir = (String.isNotBlank(sortOrder) && sortOrder.toLowerCase() == 'asc' ? 'ASC' : 'DESC'); 
            String nullsOrder = (dir == 'ASC') ? 'NULLS FIRST' : 'NULLS LAST';
            query += ' ORDER BY ' + ss + ' ' + dir + ' ' + nullsOrder; 
        }
        else query += ' ORDER BY CreatedDate DESC';
        query += ' LIMIT ' + finalLimit + ' OFFSET ' + finalOffset;
        return Database.query(query);
    }
}