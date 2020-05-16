import { Connection, LoggerLevel, Org } from "@salesforce/core";
import request from "request-promise-native";
import { SFPowerkit } from "../../../sfpowerkit";
import { sfdx } from "@pony-ci/sfdx-node";
import retry from "async-retry";

const ORDER_BY_FILTER = " ORDER BY CreatedDate ASC";
export default class ScratchOrgUtils {
  public static async getScratchOrgLimits(hubOrg: Org, apiversion: string) {
    let conn = hubOrg.getConnection();

    var query_uri = `${conn.instanceUrl}/services/data/v${apiversion}/limits`;
    const limits = await request({
      method: "get",
      url: query_uri,
      headers: {
        Authorization: `Bearer ${conn.accessToken}`
      },
      json: true
    });

    SFPowerkit.log(
      `Limits Fetched: ${JSON.stringify(limits)}`,
      LoggerLevel.TRACE
    );
    return limits;
  }

  public static async getScratchOrgRecordsAsMapByUser(hubOrg: Org) {
    let conn = hubOrg.getConnection();
    let query =
      "SELECT count(id) In_Use, SignupEmail FROM ActiveScratchOrg GROUP BY SignupEmail ORDER BY count(id) DESC";
    const results = (await conn.query(query)) as any;
    SFPowerkit.log(
      `Info Fetched: ${JSON.stringify(results)}`,
      LoggerLevel.DEBUG
    );

    let scratchOrgRecordAsMapByUser = ScratchOrgUtils.arrayToObject(
      results.records,
      "SignupEmail"
    );
    return scratchOrgRecordAsMapByUser;
  }

  private static async getScratchOrgLoginURL(
    hubOrg: Org,
    username: string
  ): Promise<any> {
    let conn = hubOrg.getConnection();

    let query = `SELECT Id, SignupUsername, LoginUrl FROM ScratchOrgInfo WHERE SignupUsername = '${username}'`;
    SFPowerkit.log("QUERY:" + query, LoggerLevel.DEBUG);
    const results = (await conn.query(query)) as any;
    SFPowerkit.log(
      `Login URL Fetched: ${JSON.stringify(results)}`,
      LoggerLevel.DEBUG
    );

    return results.records[0].LoginUrl;
  }

  public static async createScratchOrg(
    id: number,
    adminEmail: string,
    config_file_path: string,
    expiry: number,
    hubOrg: Org
  ): Promise<ScratchOrg> {
    SFPowerkit.log(
      "Parameters: " +
        id +
        " " +
        adminEmail +
        " " +
        config_file_path +
        " " +
        expiry +
        " ",
      LoggerLevel.TRACE
    );

    //Create Scratch Org's
    SFPowerkit.log(
      `Creating scratch org ..  ${adminEmail ? adminEmail : `SO${id}`}..`,
      LoggerLevel.INFO
    );

    let result;
    await retry(
      async bail => {
        if (adminEmail) {
          result = await sfdx.force.org.create(
            {
              quiet: true,
              definitionfile: config_file_path,
              setalias: `SO${id}`,
              durationdays: expiry,
              targetdevhubusername: hubOrg.getUsername(),
              wait: 10
            },
            `adminEmail=${adminEmail}`
          );
        } else {
          result = await sfdx.force.org.create({
            quiet: true,
            definitionfile: config_file_path,
            setalias: `SO${id}`,
            durationdays: expiry,
            targetdevhubusername: hubOrg.getUsername(),
            wait: 10
          });
        }
      },
      { retries: 3, minTimeout: 30000 }
    );

    SFPowerkit.log(result, LoggerLevel.TRACE);

    let scratchOrg: ScratchOrg = {
      alias: `SO${id}`,
      orgId: result.orgId,
      username: result.username,
      signupEmail: adminEmail ? adminEmail : ""
    };

    //Get FrontDoor URL
    scratchOrg.loginURL = await this.getScratchOrgLoginURL(
      hubOrg,
      scratchOrg.username
    );

    //Generate Password
    let passwordResult = await sfdx.force.user.password.generate({
      quiet: true,
      targetusername: scratchOrg.username,
      targetdevhubusername: hubOrg.getUsername()
    });
    scratchOrg.password = passwordResult.password;

    SFPowerkit.log(JSON.stringify(scratchOrg), LoggerLevel.TRACE);
    return scratchOrg;
  }

  public static async shareScratchOrgThroughEmail(
    scratchOrg: ScratchOrg,
    hubOrg: Org
  ) {
    let hubOrgUserName = hubOrg.getUsername();
    let body = `${hubOrgUserName} has generated a new scratch org for you in SO Pool!\n
   All the post scratch org scripts have been succesfully completed in this org!\n
   <p>The Login url for this org is : ${scratchOrg.loginURL}\n
   <p>Username: ${scratchOrg.username}\n
   <p>Password: ${scratchOrg.password}\n
   <p>Please use sfdx force:auth:web:login -r ${scratchOrg.loginURL} -a <alias>  command to authenticate against this Scratch org</p>
   <p>Thank you for using sfpowerkit!</p>`;

    const options = {
      method: "post",
      body: JSON.stringify({
        inputs: [
          {
            emailBody: body,
            emailAddresses: scratchOrg.signupEmail,
            emailSubject: `${hubOrgUserName} created you a new Salesforce org`,
            senderType: "CurrentUser"
          }
        ]
      }),
      url: "/services/data/v48.0/actions/standard/emailSimple"
    };

    await retry(
      async bail => {
        await hubOrg.getConnection().request(options);
      },
      { retries: 3, minTimeout: 30000 }
    );

    SFPowerkit.log(
      `Succesfully send email to ${scratchOrg.signupEmail} for ${scratchOrg.username}`,
      LoggerLevel.DEBUG
    );
  }

  public static async getScratchOrgRecordId(
    scratchOrgs: ScratchOrg[],
    hubOrg: Org
  ) {
    if (scratchOrgs == undefined || scratchOrgs.length == 0) return;

    let hubConn = hubOrg.getConnection();

    let scratchOrgIds = scratchOrgs
      .map(function(scratchOrg) {
        scratchOrg.orgId = scratchOrg.orgId.slice(0, 15);
        return `'${scratchOrg.orgId}'`;
      })
      .join(",");

    let query = `SELECT Id, ScratchOrg FROM ScratchOrgInfo WHERE ScratchOrg IN ( ${scratchOrgIds} )`;
    SFPowerkit.log("QUERY:" + query, LoggerLevel.TRACE);

    return await retry(
      async bail => {
        const results = (await hubConn.query(query)) as any;
        let resultAsObject = this.arrayToObject(results.records, "ScratchOrg");

        SFPowerkit.log(JSON.stringify(resultAsObject), LoggerLevel.TRACE);

        scratchOrgs.forEach(scratchOrg => {
          scratchOrg.recordId = resultAsObject[scratchOrg.orgId]["Id"];
        });

        return results;
      },
      { retries: 3, minTimeout: 3000 }
    );
  }

  public static async setScratchOrgInfo(
    soInfo: any,
    hubOrg: Org
  ): Promise<boolean> {
    let hubConn = hubOrg.getConnection();
    SFPowerkit.log(JSON.stringify(soInfo), LoggerLevel.TRACE);
    return await retry(
      async bail => {
        try {
          let result = await hubConn.sobject("ScratchOrgInfo").update(soInfo);
          return result.success;
        } catch (err) {
          SFPowerkit.log(
            "Failure at setting ScratchOrg Info" + err,
            LoggerLevel.TRACE
          );
          return false;
        }
      },
      { retries: 3, minTimeout: 3000 }
    );
  }

  public static async getScratchOrgsByTag(
    tag: string,
    hubOrg: Org,
    isMyPool: boolean,
    unAssigned: boolean
  ) {
    let hubConn = hubOrg.getConnection();

    return await retry(
      async bail => {
        let query = `SELECT Id,  CreatedDate, ScratchOrg, ExpirationDate, SignupUsername, SignupEmail, Password__c, Allocation_status__c,LoginUrl FROM ScratchOrgInfo WHERE Pooltag__c = '${tag}'  AND Status = 'Active' `;
        if (isMyPool) {
          query =
            query + ` AND createdby.username = '${hubOrg.getUsername()}' `;
        }
        if (unAssigned) {
          query = query + `AND Allocation_status__c !='Assigned'`;
        }
        query = query + ORDER_BY_FILTER;
        SFPowerkit.log("QUERY:" + query, LoggerLevel.TRACE);
        const results = (await hubConn.query(query)) as any;
        return results;
      },
      { retries: 3, minTimeout: 3000 }
    );
  }

  public static async getActiveScratchOrgsByInfoId(
    hubOrg: Org,
    scrathOrgIds: string
  ) {
    let hubConn = hubOrg.getConnection();

    return await retry(
      async bail => {
        let query = `SELECT Id, SignupUsername FROM ActiveScratchOrg WHERE ScratchOrgInfoId IN (${scrathOrgIds}) `;

        SFPowerkit.log("QUERY:" + query, LoggerLevel.TRACE);
        const results = (await hubConn.query(query)) as any;
        return results;
      },
      { retries: 3, minTimeout: 3000 }
    );
  }
  public static async getCountOfActiveScratchOrgsByTag(
    tag: string,
    hubOrg: Org
  ): Promise<number> {
    let hubConn = hubOrg.getConnection();

    return await retry(
      async bail => {
        let query = `SELECT Id, CreatedDate, ScratchOrg, ExpirationDate, SignupUsername, SignupEmail, Password__c, Allocation_status__c,LoginUrl FROM ScratchOrgInfo WHERE Pooltag__c = '${tag}' AND Status = 'Active' `;
        SFPowerkit.log("QUERY:" + query, LoggerLevel.TRACE);
        const results = (await hubConn.query(query)) as any;
        return results.totalSize;
      },
      { retries: 3, minTimeout: 3000 }
    );
  }

  public static async getCountOfActiveScratchOrgsByTagAndUsername(
    tag: string,
    hubOrg: Org
  ): Promise<number> {
    let hubConn = hubOrg.getConnection();

    return await retry(
      async bail => {
        let query = `SELECT Id, CreatedDate, ScratchOrg, ExpirationDate, SignupUsername, SignupEmail, Password__c, Allocation_status__c,LoginUrl FROM ScratchOrgInfo WHERE Pooltag__c = '${tag}' AND Status = 'Active' `;
        SFPowerkit.log("QUERY:" + query, LoggerLevel.TRACE);
        const results = (await hubConn.query(query)) as any;
        return results.totalSize;
      },
      { retries: 3, minTimeout: 3000 }
    );
  }

  public static async deleteScratchOrg(
    hubOrg: Org,
    apiversion: string,
    id: string
  ) {
    let hubConn = hubOrg.getConnection();

    await retry(
      async bail => {
        var query_uri = `${hubConn.instanceUrl}/services/data/v${apiversion}/sobjects/ActiveScratchOrg/${id}`;
        const info = await request({
          method: "delete",
          url: query_uri,
          headers: {
            Authorization: `Bearer ${hubConn.accessToken}`
          },
          json: true
        });
      },
      { retries: 3, minTimeout: 3000 }
    );
  }

  private static arrayToObject = (array, keyfield) =>
    array.reduce((obj, item) => {
      obj[item[keyfield]] = item;
      return obj;
    }, {});
}

export interface ScratchOrg {
  recordId?: string;
  orgId?: string;
  loginURL?: string;
  signupEmail?: string;
  username?: string;
  alias?: string;
  password?: string;
  isScriptExecuted?: boolean;
  expityDate?: string;
  accessToken?: string;
  instanceURL?: string;
  status?: string;
}
