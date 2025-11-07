const core = require('@actions/core');
const github = require('@actions/github');
const Asana = require('asana');

async function asanaOperations(asanaPAT, targets, taskId, taskComment) {
  try {
    console.log(`[asana] start task=${taskId}`);
    console.log(`[asana] taskComment received: ${taskComment ? `"${taskComment}"` : 'null/undefined/falsy'}`);

    let client = Asana.ApiClient.instance;
    let token = client.authentications['token'];
    token.accessToken = asanaPAT;

    const tasksApiInstance = new Asana.TasksApi();
    const sectionsApiInstance = new Asana.SectionsApi();
    const storiesApiInstance = new Asana.StoriesApi();

    const task = await tasksApiInstance.getTask(taskId);
    const projects = task?.data?.projects || [];
    console.log(`[asana] task=${taskId} projectsFound=${projects.length}`);

    for (const target of targets) {
      try {
        const targetProject = projects.find(project => project.name === target.project);
        if (!targetProject) {
          console.log(`[asana] task-not-in-project task=${taskId} project=${target.project}`);
          continue;
        }

        console.log(`[asana] task=${taskId} moving -> ${target.project}/${target.section}`);
        const sections = await sectionsApiInstance.getSectionsForProject(targetProject.gid);
        const targetSection = sections.data.find(section => section.name === target.section);

        if (!targetSection) {
          console.error(`[asana] section-not-found project=${target.project} section=${target.section}`);
          continue;
        }

        await sectionsApiInstance.addTaskForSection(
          targetSection.gid,
          { body: { data: { task: taskId } } }
        );
        console.log(`[asana] task=${taskId} moved to ${target.project}/${target.section}`);
      } catch (moveErr) {
        console.error(`[asana] move-failed task=${taskId} target=${target.project}/${target.section} msg=${moveErr?.message || moveErr}`);
      }
    }

    if (taskComment) {
      console.log(`[asana] task=${taskId} adding comment: "${taskComment}"`);
      try {
        await storiesApiInstance.createStoryForTask({ data: { text: taskComment } }, taskId);
        console.log(`[asana] task=${taskId} comment added successfully`);
      } catch (commentError) {
        console.error(`[asana] task=${taskId} comment failed: ${commentError?.message || commentError}`);
      }
    } else {
      console.log(`[asana] task=${taskId} skipping comment (task-comment input not provided or empty)`);
    }

    console.log(`[asana] done task=${taskId}`);
  } catch (ex) {
    console.error(`[asana] error task=${taskId} msg=${ex?.message || ex}`);
  }
}

(async () => {
  try {
    const ASANA_PAT = core.getInput('asana-pat');
    const TARGETS = core.getInput('targets');
    const TRIGGER_PHRASE = core.getInput('trigger-phrase');
    const TASK_COMMENT = core.getInput('task-comment');

    const PULL_REQUEST = github.context.payload?.pull_request;

    if (!ASANA_PAT) {
      throw new Error('ASANA PAT Not Found!');
    }

    if (!PULL_REQUEST) {
      core.info('[asana] No pull_request payload in this event. Ensure the workflow runs on pull_request/pull_request_target.');
      return;
    }

    const prBody = (PULL_REQUEST.body || '').replace(/\*\*/g, '');
    console.log(`[asana] TASK_COMMENT input: "${TASK_COMMENT}" (type: ${typeof TASK_COMMENT}, length: ${TASK_COMMENT?.length || 0})`);
    const taskComment = TASK_COMMENT && TASK_COMMENT.trim() ? `${TASK_COMMENT.trim()} ${PULL_REQUEST.html_url}` : null;
    console.log(`[asana] taskComment constructed: ${taskComment ? `"${taskComment}"` : 'null'}`);

    const escapedPhrase = TRIGGER_PHRASE.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
    const REGEX = new RegExp(
      `${escapedPhrase}\\s*(?:\\*\\*)?\\s*\\[(.*?)\\]\\(https:\\/\\/app\\.asana\\.com\\/(?<urlVersion>\\d+)\\/(?<firstId>\\d+)\\/(?:project\\/)?(?<secondId>\\d+)(?:\\/task\\/)?(?<thirdId>\\d+)?[^)]*\\)`,
      'gi'
    );

    console.log(`[asana] trigger-phrase="${TRIGGER_PHRASE}" (len=${TRIGGER_PHRASE.length})`);
    console.log(`[asana] prBody length=${prBody.length}`);
    const expectedLiteral = `${TRIGGER_PHRASE} [`;
    console.log(`[asana] prBody contains exact "${expectedLiteral}" ?`, prBody.includes(expectedLiteral));
    console.log('[asana] prBody preview:\n' + prBody.slice(0, 400));

    const ops = [];
    let match;
    while ((match = REGEX.exec(prBody)) !== null) {
      const { urlVersion, secondId, thirdId } = match.groups || {};
      const taskId = urlVersion === '0' ? secondId : thirdId;
      if (taskId) {
        console.log(`[asana] enqueue task=${taskId}`);
        ops.push(asanaOperations(ASANA_PAT, TARGETS ? JSON.parse(TARGETS) : [], taskId, taskComment));
      } else {
        core.info(`Invalid Asana task URL after the trigger phrase ${TRIGGER_PHRASE}`);
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
    core.error(error?.stack || error?.message || String(error));
  }
})();
