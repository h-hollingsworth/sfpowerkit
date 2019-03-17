import { core, flags, SfdxCommand, Result } from '@salesforce/command';
import { AnyJson } from '@salesforce/ts-types';
import fs = require('fs-extra');
import request = require('request-promise-native');
import rimraf = require('rimraf');
import { Connection, SfdxError, AuthInfo, Org } from '@salesforce/core';



// Initialize Messages with the current plugin directory
core.Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = core.Messages.loadMessages('sfpowerkit', 'sandbox_info');

export default class Info extends SfdxCommand {

  public static description = messages.getMessage('commandDescription');

  public static examples = [
    `$ sfdx sfpowerkit:org:sandbox:info -n test2  -u myOrg@example.com
  Successfully Enqueued Refresh of Sandbox
  `
  ];


  protected static flagsConfig = {
    name: flags.string({ required: true, char: 'n', description: messages.getMessage('nameFlagDescription')}),
    showonlylatest: flags.boolean({ required: false, char: 's', default:false, description: messages.getMessage('showOnlyLatestFlagDescription')}),
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;



  public async run(): Promise<AnyJson> {

    rimraf.sync('temp_sfpowerkit');

    // const conn = await Connection.create({
    //   authInfo: await AuthInfo.create({ username: `${this.org.getUsername()}` })
    // });

     await this.org.refreshAuth();

     const conn = this.org.getConnection();

    this.flags.apiversion = this.flags.apiversion || await conn.retrieveMaxApiVersion();

   
    var result = await this.getSandboxInfo(conn,this.flags.name);

    if (this.flags.outputfile) {
      await fs.outputJSON(this.flags.outputfile, result);
    }

     this.ux.log(`Successfully Retrived Sandbox Details`);
     this.ux.logJson(result);
 

    rimraf.sync('temp_sfpowerkit');

    return result;
  }

  public async getSandboxInfo(conn: core.Connection, name: string) {



    var query_uri;

    if(this.flags.showonlylatest)
     query_uri = `${conn.instanceUrl}/services/data/v${this.flags.apiversion}/tooling/query?q=SELECT+Id,SandboxName+FROM+SandboxProcess+WHERE+SandboxName+in+('${name}')+ORDER+BY+LastModifiedDate+DESC`;
    else
      query_uri = `${conn.instanceUrl}/services/data/v${this.flags.apiversion}/tooling/query?q=SELECT+Id,SandboxName+FROM+SandboxProcess+WHERE+SandboxName+in+('${name}')`;

    //this.ux.log(`Query URI ${query_uri}`);

    const sandbox_query_result = await request({
      method: 'get',
      url: query_uri,
      headers: {
        Authorization: `Bearer ${conn.accessToken}`
      },
      json: true
    });



    if(sandbox_query_result.records[0]==undefined)
    throw new  SfdxError(`Unable to find a sandbox with name: ${name}`);


     var  result = await this.processSandboxInfo(sandbox_query_result.records,conn,this.flags.showonlylatest);
    
    return result;

  }


  public async  processSandboxInfo(sandboxRecords,conn,isShowOnlyLatest) {
    
    var result=[];

    for (const item of sandboxRecords) {
      var output = await this.getDetailedSandboxInfo(item.attributes.url,conn);
      result.push(output);
      if(isShowOnlyLatest)
      break;
    }
    return result;
  }

  public async getDetailedSandboxInfo(sandboxInfoUl:string,conn: core.Connection) {


    const query_uri = `${conn.instanceUrl}${sandboxInfoUl}`;

    //this.ux.log(`Query URI ${query_uri}`);

    const sandbox_query_result = await request({
      method: 'get',
      url: query_uri,
      headers: {
        Authorization: `Bearer ${conn.accessToken}`
      },
      json: true
    });
 
  
    return sandbox_query_result;
  }

}