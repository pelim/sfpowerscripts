import { Messages } from "@salesforce/core";
import BuildImpl, { BuildProps } from "../../../impl/parallelBuilder/BuildImpl";
import { Stage } from "../../../impl/Stage";
import BuildBase from "../../../buildBase";



// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("@dxatscale/sfpowerscripts", "quickbuild");

export default class QuickBuild extends BuildBase {

  public static description = messages.getMessage("commandDescription");


  getStage() {
    return Stage.QUICKBUILD;
  }


  getBuildImplementer(): BuildImpl {
     let buildProps:BuildProps = {

          configFilePath:this.flags.configfilepath,
          devhubAlias:this.hubOrg.getUsername(),
          repourl:this.flags.repourl,
          waitTime: this.flags.waittime,
          isQuickBuild:true,
          isDiffCheckEnabled: this.flags.diffcheck,
          buildNumber:this.flags.buildnumber,
          executorcount:this.flags.executorcount,
          branch:this.flags.branch,
          currentStage:Stage.QUICKBUILD,
          isBuildAllAsSourcePackages:false
      }

      let buildImpl = new BuildImpl(buildProps);
      return buildImpl;
  }
}