@IsTest
public class SLADashboardControllerTest {
    @IsTest
    static void testGetDashboardData() {
        Case c = new Case(Subject='Test', Status='New', Priority='High');
        insert c;
        SLADashboardController.DashboardData data = SLADashboardController.getDashboardData(null);
        System.assertNotEquals(null, data);
    }

    @IsTest
    static void testGetCaseListAdvanced() {
        Account acc = new Case(Subject='Test').Id != null ? null : new Account(Name='Test');
        if (acc != null) insert acc;
        Case c = new Case(Subject='Specific Search', Status='New', Priority='High');
        if (acc != null) c.AccountId = acc.Id;
        insert c;

        Test.startTest();
        List<Case> smart = SLADashboardController.getCaseList('New', null, new List<String>{'Subject'}, 'Subject', 'ASC', null, 0, 'Priority', 'High', false, 20, new List<String>{'High'}, false, null, null, false);
        System.assertEquals(1, smart.size());
        Test.stopTest();
    }
}