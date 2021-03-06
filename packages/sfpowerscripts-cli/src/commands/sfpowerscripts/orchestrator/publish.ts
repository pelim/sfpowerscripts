import { flags } from '@salesforce/command';
import SfpowerscriptsCommand from '../../../SfpowerscriptsCommand';
import { Messages } from '@salesforce/core';
import * as fs from "fs-extra"
import path = require("path");
import ArtifactFilePathFetcher, {ArtifactFilePaths} from "@dxatscale/sfpowerscripts.core/lib/artifacts/ArtifactFilePathFetcher";
import PackageMetadata from "@dxatscale/sfpowerscripts.core/lib/PackageMetadata";
import child_process = require("child_process");
import SFPStatsSender from "@dxatscale/sfpowerscripts.core/lib/utils/SFPStatsSender";
import SFPLogger from "@dxatscale/sfpowerscripts.core/lib/utils/SFPLogger";

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@dxatscale/sfpowerscripts', 'publish');

export default class Promote extends SfpowerscriptsCommand {

  public static description = messages.getMessage('commandDescription');

  public static examples = [
    `$ sfdx sfpowerscripts:orchestrator:publish -f path/to/script`,
    `$ sfdx sfpowerscripts:orchestrator:publish -p -v HubOrg`
  ];

  protected static requiresUsername = false;
  protected static requiresDevhubUsername = false;

  protected static flagsConfig = {
    artifactdir: flags.directory({
      required: true, char: 'd',
      description: messages.getMessage('artifactDirectoryFlagDescription'),
      default: 'artifacts'
    }),
    publishpromotedonly: flags.boolean({
      char: 'p',
      description: messages.getMessage('publishPromotedOnlyFlagDescription'),
      default: false,
      dependsOn: ['devhubalias']
    }),
    devhubalias: flags.string({
      char: 'v',
      description: messages.getMessage('devhubAliasFlagDescription')
    }),
    scriptpath: flags.filepath({
      required: true,
      char: 'f',
      description: messages.getMessage('scriptPathFlagDescription')
    }),
    tag: flags.string({
      char: 't',
      description: messages.getMessage('tagFlagDescription')
    }),
    gittag: flags.boolean({
      description: messages.getMessage('gitTagFlagDescription'),
      default: false,
    }),
    pushgittag: flags.boolean({
      description: messages.getMessage('gitPushTagFlagDescription'),
      default: false,
    }),

  };


  public async execute(){
    let nPublishedArtifacts: number = 0;
    let failedArtifacts: string[] = [];
    SFPLogger.isSupressLogs = true;

    let executionStartTime = Date.now();

    let succesfullyPublishedPackageNamesForTagging: {
      name: string,
      version: string,
      type: string,
      tag: string
    }[] = new Array();

    try {

    console.log("-----------sfpowerscripts orchestrator ------------------");
    console.log("command: publish");
    console.log(`Publish promoted artifacts only: ${this.flags.publishpromotedonly}`);
    console.log("---------------------------------------------------------");





      if (!fs.existsSync(this.flags.scriptpath))
        throw new Error(`Script path ${this.flags.scriptpath} does not exist`);

      let packageVersionList: any;
      if (this.flags.publishpromotedonly) {
        let packageVersionListJson: string = child_process.execSync(
          `sfdx force:package:version:list --released -v ${this.flags.devhubalias} --json`,
          {
            cwd: process.cwd(),
            stdio: ['ignore', 'pipe', 'pipe'],
            encoding: 'utf8',
            maxBuffer: 5*1024*1024
          }
        );
        packageVersionList = JSON.parse(packageVersionListJson);
      }

      let artifacts = ArtifactFilePathFetcher.findArtifacts(this.flags.artifactdir);
      let artifactFilePaths = ArtifactFilePathFetcher.fetchArtifactFilePaths(this.flags.artifactdir);

      // Pattern captures two named groups, the "package" name and "version" number
      let pattern = new RegExp("(?<package>^.*)(?:sfpowerscripts_artifact_)(?<version>.*)(?:\\.zip)");
      for (let artifact of artifacts) {
        let packageName: string;
        let packageVersionNumber: string;

        let match: RegExpMatchArray = path.basename(artifact).match(pattern);

        if (match !== null) {
          packageName = match.groups.package; // can be an empty string
          if (packageName) {
            // Remove trailing underscore
            packageName = packageName.substring(0, packageName.length - 1);
          }
          packageVersionNumber = match.groups.version;
        } else {
          // artifact filename doesn't match pattern
          continue;
        }

        let {packageType, packageVersionId} = this.getPackageVersionIdAndType(
          artifactFilePaths,
          packageName,
          packageVersionNumber
        );

        if (this.flags.publishpromotedonly && packageType === "unlocked") {
          let isReleased = this.isPackageVersionIdReleased(packageVersionList, packageVersionId);

          if (!isReleased) {
            failedArtifacts.push(`${packageName} v${packageVersionNumber}`);
            console.log(`Skipping ${packageName} Version ${packageVersionNumber}. Package Version Id ${packageVersionId} has not been promoted.`);
            process.exitCode = 1;
            continue;
          }
        }

        try {
          console.log(`Publishing ${packageName} Version ${packageVersionNumber}...`);

          let cmd: string;
          if (process.platform !== 'win32') {
            cmd = `bash -e ${this.flags.scriptpath} ${packageName} ${packageVersionNumber} ${artifact} ${this.flags.publishpromotedonly}`;
          } else {
            cmd = `cmd.exe /c ${this.flags.scriptpath} ${packageName} ${packageVersionNumber} ${artifact} ${this.flags.publishpromotedonly}`;
          }

          child_process.execSync(
            cmd,
            {
              cwd: process.cwd(),
              stdio: ['ignore', 'ignore', 'inherit']
            }
          );


          succesfullyPublishedPackageNamesForTagging.push({
            name:packageName,
            version:packageVersionNumber.replace("-", "."),
            type:packageType,
            tag:`${packageName}_v${packageVersionNumber.replace("-", ".")}`
          });

          nPublishedArtifacts++;
        } catch (err) {
          failedArtifacts.push(`${packageName} v${packageVersionNumber}`);
          console.log(err.message);
          process.exitCode = 1;
        }
      }

      if (this.flags.gittag && failedArtifacts.length == 0) {
        this.createGitTags(succesfullyPublishedPackageNamesForTagging);
        this.pushGitTags();
      }


    } catch (err) {
      console.log(err.message);

      // Fail the task when an error occurs
      process.exitCode = 1;
    } finally {
      let totalElapsedTime: number = Date.now() - executionStartTime;

      console.log(
        `----------------------------------------------------------------------------------------------------`
      );
      console.log(
        `${nPublishedArtifacts} artifacts published in ${this.getFormattedTime(
          totalElapsedTime
        )} with {${failedArtifacts.length}} errors`
      );



      if (failedArtifacts.length > 0) {
        console.log(`Packages Failed to Publish`, failedArtifacts);
      }
      console.log(
        `----------------------------------------------------------------------------------------------------`
      );

      let tags = {
        publish_promoted_only: this.flags.publishpromotedonly ? "true" : "false"
      };

      if (this.flags.tag != null) {
        tags["tag"] = this.flags.tag;
      }

      SFPStatsSender.logGauge(
        "publish.duration",
        totalElapsedTime,
        tags
      );

      SFPStatsSender.logGauge(
        "publish.succeeded",
        nPublishedArtifacts,
        tags
      );

      if (failedArtifacts.length > 0) {
        SFPStatsSender.logGauge(
          "publish.failed",
          failedArtifacts.length,
          tags
        );
      }
    }
  }
  private pushGitTags() {
    console.log("Pushing Git Tags to Repo");
    if(this.flags.pushgittag)
    {
      child_process.execSync(
        `git push --tags`
      );
    }
  }

  private createGitTags(
    succesfullyPublishedPackageNamesForTagging: {
      name: string,
      version: string,
      type: string,
      tag: string
    }[]
  ) {
      console.log("Creating Git Tags in Repo");
      child_process.execSync(`git config --global user.email "sfpowerscripts@dxscale"`);
      child_process.execSync(`git config --global user.name "sfpowerscripts"`);

      for (let packageTag of succesfullyPublishedPackageNamesForTagging) {
        child_process.execSync(
          `git tag -a -m "${packageTag.name} ${packageTag.type} Package ${packageTag.version}" ${packageTag.tag} HEAD`
        );
      }
    
  }

  private isPackageVersionIdReleased(packageVersionList: any, packageVersionId: string): boolean {
    let packageVersion = packageVersionList.result.find((pkg) => {
      return pkg.SubscriberPackageVersionId === packageVersionId;
    });

    if (packageVersion)
      return true
    else
      return false
  }

  private getPackageVersionIdAndType(
    artifactFilePaths: ArtifactFilePaths[],
    packageName,
    packageVersionNumber
  ): {packageType: string, packageVersionId: string}
  {
    let packageType: string;
    let packageVersionId: string;
    let isPackageMetadataFound: boolean;
    for (let artifact of artifactFilePaths) {
      let packageMetadata: PackageMetadata = JSON.parse(fs.readFileSync(artifact.packageMetadataFilePath, 'utf8'));
      if (
        packageMetadata.package_name === packageName &&
        packageMetadata.package_version_number === packageVersionNumber.replace("-", ".")
      ) {
        isPackageMetadataFound = true;
        packageType = packageMetadata.package_type;
        packageVersionId = packageMetadata.package_version_id;
        break;
      }
    }

    if (!isPackageMetadataFound)
      throw new Error(`Unable to find artifact metadata for ${packageName} Version ${packageVersionNumber.replace("-", ".")}`);

    return {packageType: packageType, packageVersionId: packageVersionId};
  }

  private getFormattedTime(milliseconds: number): string {
    let date = new Date(0);
    date.setSeconds(milliseconds / 1000); // specify value for SECONDS here
    let timeString = date.toISOString().substr(11, 8);
    return timeString;
  }
}