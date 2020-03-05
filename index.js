const core = require('@actions/core');
const github = require('@actions/github');
const asana = require('asana');

async function asanaOperations(
  asanaPAT,
  projectName,
  taskId,
  sectionName,
  taskComment
) {
  try {
    const client = asana.Client.create({
      defaultHeaders: { 'asana-enable': 'new-sections,string_ids' },
      logAsanaChangeWarnings: false
    }).useAccessToken(asanaPAT);

    if (sectionName && projectName) {
      let targetProject = await client.tasks.findById(taskId)
        .then(task => task.projects.find(project => project.name === projectName));
      if (targetProject) {
        let targetSection = await client.sections.findByProject(targetProject.gid)
          .then(sections => sections.find(section => section.name === sectionName));
        if (targetSection) {
          await client.sections.addTask(targetSection.gid, { task: taskId });
          core.info('Moved to: ' + targetSection.name);
        } else {
          core.error('Asana section ' + sectionName + ' not found.');
        }
      } else {
        core.error(`This task does not exist in "${projectName}" project`);
      }
    }

    if (taskComment) {
      await client.tasks.addComment(taskId, {
        text: taskComment
      });
      core.info('Added the pull request link to the Asana task.');
    }
  } catch (ex) {
    console.error(ex.value);
  }
}

try {
  const ASANA_PAT = core.getInput('asana-pat'),
    PROJECT_NAME = core.getInput('target-project'),
    SECTION_NAME = core.getInput('target-section'),
    TRIGGER_PHRASE = core.getInput('trigger-phrase'),
    TASK_COMMENT = core.getInput('task-comment'),
    PULL_REQUEST = github.context.payload.pull_request,
    REGEX = new RegExp(
      `\\*\\*${TRIGGER_PHRASE}\\*\\* \\[(.*?)\\]\\(https:\\/\\/app.asana.com\\/(\\d+)\\/(?<project>\\d+)\\/(?<task>\\d+).*?\\)`,
      'g'
    );
  let taskComment = null,
    parseAsanaURL = null;

  if (!ASANA_PAT){
    throw({message: 'ASANA PAT Not Found!'});
  }
  if (TASK_COMMENT) {
    taskComment = `${TASK_COMMENT} ${PULL_REQUEST.html_url}`;
  }
  while ((parseAsanaURL = REGEX.exec(PULL_REQUEST.body)) !== null) {
    let taskId = parseAsanaURL.groups.task;
    if (taskId) {
      asanaOperations(ASANA_PAT, PROJECT_NAME, taskId, SECTION_NAME, taskComment);
    } else {
      core.info('Invalid Asana task URL after the trigger phrase' + TRIGGER_PHRASE);
    }
  }
} catch (error) {
  core.error(error.message);
}
