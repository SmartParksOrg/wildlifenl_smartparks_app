// What a researcher does that takes more than one call: delete an experiment or a
// questionnaire with what hangs under it, and copy a questionnaire. WildlifeNL deletes nothing
// underneath a record and refuses a delete while something still points at it, so the order
// matters: messages point at answer options, answer options at questions.

import { copyBodies } from "./lib.js";
import { account } from "./session.js";
import { plural } from "./ui.js";

/** WildlifeNL allows 120 requests a minute per account. A long row of calls is spaced so the
 * rest of the app keeps working; a short one goes at once. */
const SPACED_ABOVE = 60;
const SPACE_MS = 600;

async function inTurn(calls) {
  const results = [];
  for (const call of calls) {
    if (calls.length > SPACED_ABOVE && results.length) await new Promise((resolve) => setTimeout(resolve, SPACE_MS));
    results.push(await call());
  }
  return results;
}

const remove = (path) => () => account.api.call("DELETE", path);

/** A questionnaire with its questions and their answer options. */
function withQuestions(questionnaire) {
  return account.api.call("GET", `/questionnaire/${encodeURIComponent(questionnaire.ID)}`);
}

/** The calls that delete a questionnaire: every answer option first, because one can jump to
 * a question, then the questions, then the questionnaire. */
function questionnaireRemovals(questionnaire) {
  const questions = questionnaire.questions || [];
  return [...questions.flatMap((question) => (question.answers || []).map((answer) => remove(`/answer/${answer.ID}`))), ...questions.map((question) => remove(`/question/${question.ID}`)), remove(`/questionnaire/${questionnaire.ID}`)];
}

function countsOf(questionnaires) {
  const questions = questionnaires.flatMap((questionnaire) => questionnaire.questions || []);
  return { questions: questions.length, answers: questions.reduce((sum, question) => sum + (question.answers || []).length, 0) };
}

function sentence(parts) {
  const named = parts.filter(([count]) => count).map(([count, word]) => plural(count, word));
  if (!named.length) return "";
  return ` With it go ${named.length > 1 ? `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}` : named[0]}.`;
}

/** What goes when a questionnaire is deleted, as a sentence for the question to confirm. */
export async function questionnaireContents(questionnaire) {
  const { questions, answers } = countsOf([await withQuestions(questionnaire)]);
  return `The questionnaire is removed from WildlifeNL. This cannot be undone.${sentence([[questions, "question"], [answers, "answer option"]])}`;
}

/** Deletes a question with its answer options. */
export async function deleteQuestion(question) {
  await inTurn([...(question.answers || []).map((answer) => remove(`/answer/${answer.ID}`)), remove(`/question/${question.ID}`)]);
}

export async function deleteQuestionnaire(questionnaire) {
  await inTurn(questionnaireRemovals(await withQuestions(questionnaire)));
}

/** The questionnaires of an experiment, with their questions, and its messages. */
export async function experimentParts(experiment) {
  const id = encodeURIComponent(experiment.ID);
  const [questionnaires, messages] = await Promise.all([account.api.list(`/questionnaires/experiment/${id}`), account.api.list(`/messages/experiment/${id}`)]);
  return { questionnaires, messages };
}

/** What goes when an experiment is deleted, as a sentence for the question to confirm. */
export async function experimentContents(experiment) {
  const { questionnaires, messages } = await experimentParts(experiment);
  const { questions, answers } = countsOf(questionnaires);
  return `The experiment is removed from WildlifeNL. This cannot be undone.${sentence([[messages.length, "message"], [questionnaires.length, "questionnaire"], [questions, "question"], [answers, "answer option"]])}`;
}

/** Deletes an experiment: its messages first, because a message can point at an answer
 * option, then its questionnaires, then the experiment itself. */
export async function deleteExperiment(experiment) {
  const { questionnaires, messages } = await experimentParts(experiment);
  await inTurn([...messages.map((message) => remove(`/message/${message.ID}`)), ...questionnaires.flatMap(questionnaireRemovals), remove(`/experiment/${experiment.ID}`)]);
}

/**
 * Copies a questionnaire with its questions and answer options. `body` is the new
 * questionnaire: its experiment, name, identifier and kind of report. The questions are made
 * first, so a jump of an answer option can point at the new question. When a call fails, what
 * was made is removed again and the error is passed on.
 */
export async function copyQuestionnaire(original, body) {
  const { api } = account;
  const { questions, answers } = copyBodies(await withQuestions(original));
  const copy = await api.call("POST", "/questionnaire/", body);
  try {
    const made = await inTurn(questions.map((question) => () => api.call("POST", "/question/", { ...question.body, questionnaireID: copy.ID })));
    const newID = new Map(questions.map((question, index) => [question.from, made[index].ID]));
    await inTurn(answers.map((answer) => () => api.call("POST", "/answer/", { ...answer.body, questionID: newID.get(answer.of), ...(answer.next ? { nextQuestionID: newID.get(answer.next) } : {}) })));
  } catch (error) {
    await deleteQuestionnaire(copy).catch(() => {}); // the first error is the one to show
    throw error;
  }
  return copy;
}

/** The answer options of an experiment to pick one from, each named with its questionnaire
 * and question: what a message with the trigger "answer" is tied to. */
export async function answersOf(experiment) {
  const questionnaires = await account.api.list(`/questionnaires/experiment/${encodeURIComponent(experiment.ID)}`);
  return questionnaires.flatMap((questionnaire) => (questionnaire.questions || []).flatMap((question) => (question.answers || []).map((answer) => ({ ID: answer.ID, text: `${questionnaire.name}, question ${question.index}: ${answer.text}` }))));
}
