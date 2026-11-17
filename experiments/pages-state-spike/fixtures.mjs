import {task} from './config.mjs';
export function samples(now=Date.now()) {
  const settings={taskId:task.id,kind:'settings',url:`https://github.com/${task.repository}/settings/pages`,observedAt:now,
    branch:task.branch,directory:task.directory,saveEnabled:false,disabled:false,sourceConfiguredText:true,
    liveSite:task.site,deploymentUrl:`https://github.com/${task.repository}/actions/runs/43801722077`};
  const workflow={taskId:task.id,kind:'workflow',url:settings.deploymentUrl,observedAt:now,
    status:'success',isPagesWorkflow:true,commit:task.commit,siteLinked:true};
  const site={taskId:task.id,kind:'site',url:task.site,observedAt:now,marker:task.marker};
  return {
    empty:[],
    unconfigured:[{...settings,branch:'None',directory:null,saveEnabled:true,disabled:true,sourceConfiguredText:false,liveSite:null,deploymentUrl:null}],
    unsaved:[{...settings,disabled:true,saveEnabled:true,liveSite:null,deploymentUrl:null}],
    configured:[{...settings,liveSite:null,deploymentUrl:null}],
    building:[settings,{...workflow,status:'in progress',siteLinked:false}],
    oldContent:[settings,workflow,{...site,marker:'WG-OLD'}],
    complete:[settings,workflow,site],
    failure:[settings,{...workflow,status:'failure'},site],
  };
}
