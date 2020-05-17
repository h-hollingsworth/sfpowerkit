import { core, flags, SfdxCommand } from "@salesforce/command";
import { AnyJson } from "@salesforce/ts-types";
import { SFPowerkit, LoggerLevel } from "../../../sfpowerkit";
import PoolFetchImpl from "../../../impl/pool/scratchorg/poolFetchImpl";

// Initialize Messages with the current plugin directory
core.Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = core.Messages.loadMessages(
  "sfpowerkit",
  "scratchorg_poolFetch"
);

export default class Fetch extends SfdxCommand {
  public static description = messages.getMessage("commandDescription");

  protected static requiresDevhubUsername = true;

  public static examples = [
    `$ sfdx sfpowerkit:org:scratchorg:pool:fetch -t core `,
    `$ sfdx sfpowerkit:org:scratchorg:pool:fetch -t core -v devhub`,
    `$ sfdx sfpowerkit:org:scratchorg:pool:fetch -t core -v devhub -m`
  ];

  protected static flagsConfig = {
    tag: flags.string({
      char: "t",
      description: messages.getMessage("tagDescription"),
      required: true
    }),
    mypool: flags.boolean({
      char: "m",
      description: messages.getMessage("mypoolDescription"),
      required: false
    })
  };

  public async run(): Promise<AnyJson> {
    SFPowerkit.setLogLevel("DEBUG", false);

    await this.hubOrg.refreshAuth();
    const hubConn = this.hubOrg.getConnection();

    this.flags.apiversion =
      this.flags.apiversion || (await hubConn.retrieveMaxApiVersion());

    let fetchImpl = new PoolFetchImpl(
      this.hubOrg,
      this.flags.apiversion,
      this.flags.tag,
      this.flags.mypool
    );

    let result = await fetchImpl.execute();

    if (!this.flags.json) {
      this.ux.log(`======== Scratch org details ========`);
      let list = [];
      for (let [key, value] of Object.entries(result)) {
        if (value) {
          list.push({ key: key, value: value });
        }
      }
      this.ux.table(list, ["key", "value"]);
    }

    return JSON.stringify(result);
  }
}