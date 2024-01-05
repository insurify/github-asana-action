const core = require('@actions/core');
const github = require('@actions/github');
const Asana = require('asana');

const getProjectByName = async (projectName) => {
  let projectsApiInstance = new Asana.ProjectsApi();
  let opts = {
    'opt_fields': "name"
  };
  let projects = await projectsApiInstance.getProjectsForWorkspace(workspaceId, opts);
  let project = projects.data.find(project => project.name === projectName);
  return project;
}

const addTaskToProjectIfFound = async (taskId, projectName) => {
  let project = await getProjectByName(projectName);
  if (project) {
    let tasksApiInstance = new Asana.TasksApi();
    let body = { 'data': { 'project': project.gid } }
    await tasksApiInstance.addProjectForTask(body, taskId);
    core.info(`Added to: ${projectName}`);
  } else {
    core.error(`Asana project ${projectName} not found.`);
  }
}

const moveTaskToSectionIfFound = async (taskId, projectName, sectionName) => {
  let project = await getProjectByName(projectName);
  if (!project) {
    core.error(`Asana project ${projectName} not found.`);
    return;
  }
  let sectionsApiInstance = new Asana.SectionsApi();
  let sections = await sectionsApiInstance.getSectionsForProject(project.gid);
  let section = sections.data.find(section => section.name === sectionName);
  if (!section) {
    core.error(`Asana section ${sectionName} not found.`);
    return;
  }
  // add task to section
  let body = { 'data': { 'task': taskId } }
  await sectionsApiInstance.addTaskForSection(section.gid, { body });
}


const asanaOperations = async (
  asanaPAT,
  workspaceId,
  targets,
  taskId,
  taskComment
) => {

  let client = Asana.ApiClient.instance;
  let token = client.authentications['token'];
  token.accessToken = asanaPAT;

  let tasksApiInstance = new Asana.TasksApi();
  let opts = {
    'opt_fields': "projects,projects.name"
  };
  let task = await tasksApiInstance.getTask(taskId, opts)

  // add to target project if not added
  let projects = task.projects.map(project => project.name);
  targets.forEach(async target => {
    if (!projects.includes(target.project)) {
      await addTaskToProjectIfFound(taskId, target.project);
    }
  });

  // get the task again for moving section
  opts = {
    'opt_fields': "projects,projects.name,memberships.project.section,memberships.section.name,memberships.section"
  };
  task = await tasksApiInstance.getTask(taskId, opts)
  targets.forEach(async target => {
    // find section in target project
    let targetMembership = task.memberships.find(membership => membership.project.name === target.project);
    if (!targetMembership) {
      core.error(`Asana project ${target.project} not found.`);
      return;
    }
    let targetSection = targetMembership.section;
    if (!targetSection) {
      core.error(`Asana section ${target.section} not found.`);
      return;
    }
    // move to target section if not matched
    if (targetSection.name === target.section) {
      core.info(`Already in: ${target.project}/${target.section}`);
      return
    }
    await moveTaskToSectionIfFound(taskId, target.project, target.section);
  });

  if (taskComment) {
    await client.tasks.addComment(taskId, {
      text: taskComment
    });
    core.info('Added the pull request link to the Asana task.');
  }
}

try {
  const ASANA_PAT = core.getInput('asana-pat'),
    WORKSPACE_ID = core.getInput('workspace'),
    TARGETS = core.getInput('targets'),
    TRIGGER_PHRASE = core.getInput('trigger-phrase'),
    TASK_COMMENT = core.getInput('task-comment'),
    PULL_REQUEST = github.context.payload.pull_request,
    REGEX = new RegExp(
      `${TRIGGER_PHRASE} *\\[(.*?)\\]\\(https:\\/\\/app.asana.com\\/(\\d+)\\/(?<project>\\d+)\\/(?<task>\\d+).*?\\)`,
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
  while ((parseAsanaURL = REGEX.exec(PULL_REQUEST.body)) !== null) {
    let taskId = parseAsanaURL.groups.task;
    if (taskId) {
      asanaOperations(ASANA_PAT, targets, taskId, taskComment);
    } else {
      core.info(`Invalid Asana task URL after the trigger phrase ${TRIGGER_PHRASE}`);
    }
  }
} catch (error) {
  core.error(error.message);
}
