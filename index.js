const core = require('@actions/core');
const github = require('@actions/github');
const Asana = require('asana');

async function asanaOperations(
  asanaPAT,
  targets,
  taskId,
  taskComment
) {
  try {
    let client = Asana.ApiClient.instance;
    let token = client.authentications['token'];
    token.accessToken = asanaPAT;
    let tasksApiInstance = new Asana.TasksApi();
    let sectionsApiInstance = new Asana.SectionsApi();
    let storiesApiInstance = new Asana.StoriesApi();

    const task = await tasksApiInstance.getTask(taskId);
    core.info(`Processing task: ${taskId}`);

    for (const target of targets) {
      let targetProject = task.data.projects.find(project => project.name === target.project);
      if (targetProject) {
        let targetSection = await sectionsApiInstance.getSectionsForProject(targetProject.gid)
          .then(sections => sections.data.find(section => section.name === target.section));
        if (targetSection) {
          await sectionsApiInstance.addTaskForSection(targetSection.gid, { body: { data: { task: taskId } } });
          core.info(`Moved to: ${target.project}/${target.section}`);
        } else {
          core.error(`Asana section ${target.section} not found.`);
        }
      } else {
        core.info(`This task does not exist in "${target.project}" project`);
      }
    }

    if (taskComment) {
      await storiesApiInstance.createStoryForTask({ data: { text: taskComment } }, taskId);
      core.info('Added the pull request link to the Asana task.');
    }

    core.info(`Successfully completed operations for task ${taskId}`);
  } catch (ex) {
    core.error(`Failed to process task ${taskId}: ${ex.message || JSON.stringify(ex)}`);
    if (ex.response) {
      core.error(`Asana API Response: ${JSON.stringify(ex.response)}`);
    }
    // Re-throw to ensure the Promise.all fails if any operation fails
    throw ex;
  }
}

(async () => {
  try {
    const ASANA_PAT = core.getInput('asana-pat'),
      TARGETS = core.getInput('targets'),
      TRIGGER_PHRASE = core.getInput('trigger-phrase'),
      TASK_COMMENT = core.getInput('task-comment'),
      PULL_REQUEST = github.context.payload.pull_request,
      REGEX = new RegExp(
        `${TRIGGER_PHRASE} *\\[(.*?)\\]\\(https:\\/\\/app.asana.com\\/(?<urlVersion>\\d+)\\/(?<firstId>\\d+)\\/(project\\/)?(?<secondId>\\d+)(\\/task\\/)?(?<thirdId>\\d+)?.*?\\)`,
        'g'
      );
    let taskComment = null,
      targets = TARGETS? JSON.parse(TARGETS) : [],
      parseAsanaURL = null;

    if (!ASANA_PAT){
      throw({message: 'ASANA PAT Not Found!'});
    }
    if (TASK_COMMENT) {
      taskComment = `${TASK_COMMENT} ${PULL_REQUEST.html_url}`;
    }
    // Wait for all asana operations to complete
    const asanaPromises = [];
    while ((parseAsanaURL = REGEX.exec(PULL_REQUEST.body)) !== null) {
      let { urlVersion, secondId, thirdId } = parseAsanaURL.groups;
      let taskId = null;
      if (urlVersion) {
        taskId = urlVersion === "0" ? secondId : thirdId;
        if (taskId) {
          // Store promises to await them later
          asanaPromises.push(asanaOperations(ASANA_PAT, targets, taskId, taskComment));
        } else {
          core.info(`Invalid Asana task URL after the trigger phrase ${TRIGGER_PHRASE}`);
        }
      }
    }

    // Wait for all asana operations to complete
    if (asanaPromises.length === 0) {
      core.info('No Asana tasks found in PR description.');
    } else {
      core.info(`Processing ${asanaPromises.length} Asana task(s)...`);
      await Promise.all(asanaPromises);
      core.info('All Asana operations completed successfully.');
    }
  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
    if (error.stack) {
      core.error(`Stack trace: ${error.stack}`);
    }
    throw error; // Re-throw to fail the action
  }
})();
