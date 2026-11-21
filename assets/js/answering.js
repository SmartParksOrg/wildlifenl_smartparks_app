// Answering the questionnaire that belongs to a report. A running experiment can attach a
// questionnaire to a report; WildlifeNL sends it back with the report. Its questions are asked
// one at a time in the dialog of form.js, and each answer goes to WildlifeNL at once, so a
// person can stop halfway and go on later from the page of the report.

import { openForm } from "./form.js";
import { answeredOf, openQuestion, responseBodies } from "./lib.js";
import { account } from "./session.js";
import { toast } from "./ui.js";

/** The fields of the form for one question: the answer options to pick from, one or several,
 * and a text where the question takes one. */
function fieldsOf(question) {
  const options = [...(question.answers || [])].sort((a, b) => (a.index || 0) - (b.index || 0)).map((answer) => ({ value: answer.ID, label: answer.text }));
  const fields = [];
  const choices = {};
  if (options.length) {
    fields.push({ name: "picked", label: question.text, kind: question.allowMultipleResponse ? "ticks" : "choice", required: true, description: question.allowMultipleResponse ? "Tick every answer that fits." : "" });
    choices.picked = options;
  }
  if (!options.length || question.allowOpenResponse) {
    // a format is a pattern the whole answer must match, which a single line can check
    fields.push({ name: "text", label: options.length ? "In your own words" : question.text, kind: question.openResponseFormat ? "text" : "longtext", required: !options.length, minLength: 1, pattern: question.openResponseFormat || undefined, description: question.openResponseFormat ? `The answer must have this form: ${question.openResponseFormat}` : "" });
  }
  return { fields, choices };
}

/**
 * Asks the questions of the questionnaire of `report` that are still open and sends the
 * answers. Resolves to true when every question is answered, and to null when the person
 * stopped or nothing was left to ask.
 */
export async function answerReport(report) {
  const { api } = account;
  let { questionnaire } = report;
  if (!questionnaire) return null;
  // a list of reports names the questionnaire without its questions
  if (!questionnaire.questions) questionnaire = await api.call("GET", `/questionnaire/${encodeURIComponent(questionnaire.ID)}`);
  const questions = questionnaire.questions || [];
  const answered = answeredOf(await api.list("/responses/me/"), report.ID);
  if (!openQuestion(questions, answered)) {
    toast(questions.length ? "You answered every question about this report." : "This questionnaire has no questions.");
    return null;
  }
  for (let question = openQuestion(questions, answered); question; question = openQuestion(questions, answered)) {
    const { fields, choices } = fieldsOf(question);
    const sent = new Set(); // what went through, so a second try after an error sends only the rest
    const done = await openForm({
      title: questionnaire.name || "Questions about your report",
      subtitle: "Your answers go to the researchers of this experiment. You can stop and go on later from the page of the report.",
      text: question.description || "",
      fields,
      choices,
      submit: "Send answer",
      send: async ({ picked = [], text = "" }) => {
        const bodies = responseBodies(question, report.ID, [].concat(picked), text);
        const responses = [];
        for (const body of bodies) {
          if (sent.has(body.answerID)) continue;
          responses.push(await api.call("POST", "/response/", body));
          sent.add(body.answerID);
        }
        answered[question.ID] = bodies.map((body) => body.answerID).filter(Boolean);
        return responses;
      },
    });
    if (!done) return null;
    // an answer can trigger a message of the experiment
    for (const response of done.result) {
      const message = response && response.conveyance && response.conveyance.message;
      if (message && message.text) toast(message.name ? `${message.name}: ${message.text}` : message.text);
    }
  }
  return true;
}
