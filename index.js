const core = require('@actions/core');
const github = require('@actions/github');
const Asana = require('asana');

async function asanaOperations(asanaPAT, targets, taskId, taskComment) {
  try {
    console.log(`[asana] start task=${taskId}`);

    let client = Asana.ApiClient.instance;
    let token = client.authentications['token'];
    token.accessToken = asanaPAT;

    let tasksApiInstance = new Asana.TasksApi();
    let sectionsApiInstance = new Asana.SectionsApi();
    let storiesApiInstance = new Asana.StoriesApi();

    const task = await tasksApiInstance.getTask(taskId);
    const projects = task?.data?.projects || [];
    console.log(`[asana] task=${taskId} projectsFound=${projects.length}`);

    // REPLACED forEach with for...of and awaited each step
    for (const target of targets) {
      const targetProject = projects.find(project => project.name === target.project);

      if (targetProject) {
        console.log(`[asana] task=${taskId} moving -> ${target.project}/${target.section}`);
        const targetSection = await sectionsApiInstance
          .getSectionsForProject(targetProject.gid)
          .then(sections => sections.data.find(section => section.name === target.section));

        if (targetSection) {
          await sectionsApiInstance.addTaskForSection(
            targetSection.gid,
            { body: { data: { task: taskId } } }
          );
          console.log(`[asana] task=${taskId} moved to ${target.project}/${target.section}`);
        } else {
          console.error(`[asana] section-not-found project=${target.project} section=${target.section}`);
        }
      } else {
        console.log(`[asana] task-not-in-project task=${taskId} project=${target.project}`);
      }
    }

    if (taskComment) {
      console.log(`[asana] task=${taskId} adding comment: "${taskComment}"`);
      try {
        // Use the original working format
        await storiesApiInstance.createStoryForTask({ data: { text: taskComment } }, taskId);
        console.log(`[asana] task=${taskId} comment added successfully`);
      } catch (commentError) {
        console.error(`[asana] task=${taskId} comment failed:`, commentError.message);
        console.error(`[asana] task=${taskId} comment error details:`, commentError);
      }
    } else {
      console.log(`[asana] task=${taskId} no comment to add`);
    }

    console.log(`[asana] done task=${taskId}`);
  } catch (ex) {
    console.error(`[asana] error task=${taskId} msg=${ex.message || ex}`);
    // keep behavior same but more informative
  }
}

// wrap the original top-level try/catch so we can use await
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
      targets = TARGETS ? JSON.parse(TARGETS) : [],
      parseAsanaURL = null;

    if (!ASANA_PAT) {
      throw ({ message: 'ASANA PAT Not Found!' });
    }
    if (TASK_COMMENT) {
      taskComment = `${TASK_COMMENT} ${PULL_REQUEST.html_url}`;
    }

    const prBody = PULL_REQUEST?.body || '';
    const ops = [];

    while ((parseAsanaURL = REGEX.exec(prBody)) !== null) {
      let { urlVersion, secondId, thirdId } = parseAsanaURL.groups;
      let taskId = null;
      if (urlVersion) {
        taskId = urlVersion === "0" ? secondId : thirdId;
        if (taskId) {
          console.log(`[asana] enqueue task=${taskId}`);
          // collect promises and await them all after the loop
          ops.push(asanaOperations(ASANA_PAT, targets, taskId, taskComment));
        } else {
          core.info(`Invalid Asana task URL after the trigger phrase ${TRIGGER_PHRASE}`);
        }
      }
    }

    if (ops.length === 0) {
      console.log('[asana] no tasks matched in PR body');
    } else {
      console.log(`[asana] processing ${ops.length} task(s) ...`);
      await Promise.all(ops);
      console.log('[asana] all operations completed');
    }
  } catch (error) {
    core.error(error.message);
  }
})();
