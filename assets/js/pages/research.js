// What the record pages of an experiment and of a questionnaire show beside their fields:
// where the experiment stands and what it still misses, and the questions of a questionnaire
// in the order they are asked, each with its answer options and the buttons to change them.

import { experimentStatus, questionOrder, readiness, whyLocked } from "../lib.js";
import { experimentParts } from "../research.js";
import { account, explain } from "../session.js";
import { el } from "../ui.js";
import { drawActions } from "../writes.js";

const STATUS = { upcoming: "Not started yet", live: "Live", completed: "Ended" };

/** A line that says where the experiment stands and, when the account cannot change it, why. */
function standing(experiment) {
  const locked = whyLocked(experiment, account.session.userID);
  return el("p", { class: "hint" }, [el("span", { class: "badge", text: STATUS[experimentStatus(experiment)] }), " ", locked || "You can change this experiment, its questionnaires and its messages until it starts."]);
}

function card(title, children) {
  return el("div", { class: "card stack" }, [el("h2", { text: title }), ...children]);
}

/** The card of an experiment: where it stands, and before the start what it still misses. */
export function experimentCard(experiment) {
  const list = el("div", { class: "stack" });
  if (experimentStatus(experiment) === "upcoming") {
    list.append(el("p", { class: "hint", text: "Checking what it still needs…" }));
    experimentParts(experiment)
      .then(({ questionnaires, messages }) => {
        const missing = readiness(questionnaires, messages);
        list.replaceChildren(missing.length ? el("ul", { class: "plain-list" }, missing.map((text) => el("li", { text }))) : el("p", { class: "hint", text: "Nothing is missing: every questionnaire has questions that can be answered." }));
      })
      .catch((error) => {
        const text = explain(error);
        if (text) list.replaceChildren(el("p", { class: "hint", text }));
      });
  }
  return card("Where this experiment stands", [standing(experiment), list]);
}

/**
 * The card of a questionnaire: its questions in the order they are asked. A question and an
 * answer option do not say which experiment they belong to, so their buttons are drawn here,
 * with the experiment of the questionnaire added, and `reload` reads the page again after one.
 */
export function questionsCard(questionnaire, reload) {
  const { experiment } = questionnaire;
  const questions = questionOrder(questionnaire.questions);
  const place = new Map(questions.map((question) => [question.ID, question.index]));
  const buttons = (kind, record) => {
    const target = el("span", { class: "row" });
    drawActions(target, kind, "record", { ...record, experiment }, reload);
    return target;
  };
  const rows = questions.map((question, at) => {
    const answers = [...(question.answers || [])].sort((a, b) => (a.index || 0) - (b.index || 0));
    const kind = [answers.length ? (question.allowMultipleResponse ? "several answers" : "one answer") : "", question.allowOpenResponse || !answers.length ? "a text" : "", question.openResponseFormat ? `in the form ${question.openResponseFormat}` : ""].filter(Boolean).join(", ");
    // a jump can only go forward, so the next question is picked from the later ones
    const later = questions.slice(at + 1).map((other) => ({ ID: other.ID, text: `${other.index}. ${other.text}` }));
    return el("div", { class: "question" }, [
      el("div", { class: "row between" }, [el("strong", { text: `${question.index}. ${question.text}` }), buttons("questions", { ...question, later })]),
      question.description ? el("p", { class: "hint", text: question.description }) : null,
      el("p", { class: "hint", text: `Takes ${kind}.` }),
      answers.length
        ? el("ul", { class: "plain-list" }, answers.map((answer, nth) => el("li", { class: "row between" }, [el("span", { text: `${String.fromCharCode(65 + (nth % 26))}. ${answer.text}${answer.nextQuestionID ? `, then on to question ${place.get(answer.nextQuestionID) || "of another questionnaire"}` : ""}` }), buttons("answers", answer)])))
        : null,
    ]);
  });
  return card("Questions", [standing(experiment), ...(rows.length ? rows : [el("p", { class: "empty", text: "No questions yet." })])]);
}
