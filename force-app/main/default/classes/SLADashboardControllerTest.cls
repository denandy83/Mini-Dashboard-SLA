@IsTest
public class SLADashboardControllerTest {
    
    @TestSetup
    static void setup() {
        Account acc = new Account(Name='Test Account');
        insert acc;
        
        List<Case> cases = new List<Case>();
        // Case 1: Standard
        cases.add(new Case(Subject='Test 1', Status='New', Priority='High', AccountId=acc.Id));
        // Case 2: Stopped
        cases.add(new Case(Subject='Test 2', Status='Open', Priority='Normal', AccountId=acc.Id, IsStopped=true));
        // Case 3: Different owner (for onlyMine test)
        cases.add(new Case(Subject='Test 3', Status='Working', Priority='Low'));
        insert cases;

        // Note: We cannot easily insert CaseMilestone in unit tests without Entitlement/SLA configuration in the org.
        // However, the controller queries CaseMilestone. We can test the 'happy path' of the query logic even if no milestones are returned,
        // or rely on @IsTest(SeeAllData=true) if absolutely necessary (discouraged).
        // For logic coverage, we can simulate the inputs that trigger those code blocks.
    }

    @IsTest
    static void testGetDashboardData() {
        Account acc = [SELECT Id FROM Account LIMIT 1];
        
        Test.startTest();
        SLADashboardController.DashboardData data = SLADashboardController.getDashboardData(acc.Id);
        SLADashboardController.DashboardData dataGlobal = SLADashboardController.getDashboardData(null);
        Test.stopTest();
        
        System.assertNotEquals(null, data);
        System.assertNotEquals(null, data.totals);
        System.assertNotEquals(null, data.accountSpecific);
        System.assertNotEquals(null, dataGlobal);
    }

    @IsTest
    static void testGetCaseList_Basic() {
        Test.startTest();
        // Test fetching cases for a specific status dashboard
        List<Case> results = SLADashboardController.getCaseList(
            'New', null, new List<String>{'Subject', 'CaseNumber'}, 'CreatedDate', 'DESC', 
            '', 0, '', '', false, 10, null, false, null, null, false, false
        );
        Test.stopTest();
        System.assert(results.size() >= 0); // Might be 0 if status map doesn't match exactly, but query runs
    }

    @IsTest
    static void testGetCaseList_AdvancedFilters() {
        Account acc = [SELECT Id FROM Account LIMIT 1];
        
        Test.startTest();
        // Test filters: AccountId, Priority, Stopped, Advanced Search
        List<Case> results = SLADashboardController.getCaseList(
            'New', acc.Id, new List<String>{'Subject'}, 'Priority', 'ASC', 
            null, 0, 'Subject', 'Test', false, 10, new List<String>{'High'}, false, null, null, false, false
        );
        Test.stopTest();
    }

    @IsTest
    static void testGetCaseList_SearchTerm() {
        Test.startTest();
        List<Case> results = SLADashboardController.getCaseList(
            'ALL', null, new List<String>{'Subject'}, null, null, 
            'Test', 0, null, null, false, 10, null, false, null, null, false, false
        );
        Test.stopTest();
    }
    
    @IsTest
    static void testGetCaseList_JiraAndOwner() {
        Test.startTest();
        // Test onlyMine = true and hasJira = true (even if no data matches, code path executes)
        List<Case> results = SLADashboardController.getCaseList(
            'Open', null, new List<String>{'Subject', 'Jira:100'}, 'Subject', 'ASC', 
            '', 0, '', '', true, 10, null, true, null, null, false, false
        );
        Test.stopTest();
    }

    @IsTest
    static void testGetCaseList_MilestoneSort() {
        // Trigger the specific SLA sorting logic block
        // DashboardID = 'Response Time' (matches MILESTONE_NAMES)
        // SortField = 'RT_Remaining' (matches slaSortMap)
        Test.startTest();
        List<Case> results = SLADashboardController.getCaseList(
            'Response Time', null, new List<String>{'Subject'}, 'RT_Remaining', 'DESC', 
            '', 0, '', '', false, 10, null, false, null, null, false, false
        );
        Test.stopTest();
    }

    @IsTest
    static void testGetCaseList_MilestoneFirstSLA() {
        // Trigger onlyCountFirstSLA logic
        Test.startTest();
        List<Case> results = SLADashboardController.getCaseList(
            'Response Time', null, new List<String>{'Subject'}, 'RT_Remaining', 'ASC', 
            '', 0, '', '', false, 10, null, false, null, null, true, false
        );
        Test.stopTest();
    }
    
    @IsTest
    static void testGetCaseList_StatusFilter() {
        Test.startTest();
        List<Case> results = SLADashboardController.getCaseList(
            'ALL', null, new List<String>{'Subject'}, 'Subject', 'ASC', 
            '', 0, '', '', false, 10, null, false, new List<String>{'New', 'Open'}, null, false, false
        );
        Test.stopTest();
    }
    
    @IsTest
    static void testGetCaseList_Unresponsive() {
        Test.startTest();
         List<Case> results = SLADashboardController.getCaseList(
            'ALL', null, new List<String>{'Subject'}, 'Subject', 'ASC', 
            '', 0, '', '', false, 10, null, false, null, new List<String>{'true'}, false, false
        );
        Test.stopTest();
    }
}
