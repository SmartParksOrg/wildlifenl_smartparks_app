// What a person can change in WildlifeNL from this app: the actions per kind of record, each
// one call of the API. Whether the account may do an action comes from the API's own
// description (rights.js), and so do the fields of its form, so an action follows the server
// the account is signed in to.

import { answerReport } from "./answering.js";
import { SCOPES } from "./api.js";
import { loadOwnReports } from "./detections.js";
import { openForm } from "./form.js";
import { formFields, formValues } from "./lib.js";
import { loadPeople } from "./people.js";
import { TYPES, forget, listRecords, remember, titleOf } from "./records.js";
import { loadApi, operationOf } from "./rights.js";
import { account, explain, hasScope } from "./session.js";
import { loadSensors } from "./store.js";
import { busy, el, toast } from "./ui.js";

/** Whether a record belongs to the account, where the record says whose it is. WildlifeNL
 * only lets the owner change an experiment, what hangs under it, or a zone. */
function own(record) {
  const user = record.user || (record.experiment && record.experiment.user);
  return !user || user.ID === account.session.userID;
}

const now = () => new Date().toISOString();
const reloadPeople = () => loadPeople(true).catch(() => {}); // the pages that show people report their own errors

/**
 * The actions, by kind of record: a key of TYPES in records.js, `animals` or `account`.
 * - `where` puts the button above the `list` or on the page of one `record`.
 * - `call` is the method and the path as the API writes it; `{id}` is the ID of the record.
 * - `edit` starts the form with the record as it is.
 * - `preset(record)` are fields the record decides, which the form leaves out.
 * - `hide` are fields the form leaves out and sends back unchanged.
 * - `defaults()` are values a new form starts with.
 * - `choices` gives per field the records to pick from, where that is not every record.
 * - `when` says per part of the form when it is needed.
 * - `show(record)` hides the button for a record the action does not fit.
 * - `needs` are the roles for a call the API leaves open to every account but only carries
 *   out for the owner.
 * - `text` explains the action; with `confirm` it is all the dialog asks.
 * - `gone` says the record is no more afterwards; `after(result)` does what follows, with
 *   what WildlifeNL answered.
 * - `run(record)` does the whole action itself, in place of one form and one call; `call`
 *   then only says which call decides who may.
 */
export const ACTIONS = {
  species: [
    { label: "Add species", where: "list", call: ["POST", "/species/"] },
    { label: "Edit", where: "record", call: ["PUT", "/species/{id}"], edit: true },
  ],
  livinglabs: [
    { label: "Add living lab", where: "list", call: ["POST", "/livinglab/"] },
    { label: "Edit", where: "record", call: ["PUT", "/livinglab/{id}"], edit: true },
  ],
  zones: [
    { label: "Add zone", where: "list", call: ["POST", "/zone/"], text: "Draw the area on the map. Afterwards add the species the zone warns you about." },
    { label: "Add a species", where: "record", call: ["POST", "/zone/species/"], preset: (zone) => ({ zoneID: zone.ID }), show: (zone) => own(zone) && !zone.deactivated, text: "The zone raises an alarm when an animal of this species comes inside it." },
    { label: "Remove a species", where: "record", call: ["PUT", "/zone/species/"], preset: (zone) => ({ zoneID: zone.ID }), choices: { speciesID: (zone) => zone.species || [] }, show: (zone) => own(zone) && !zone.deactivated && (zone.species || []).length > 0 },
    { label: "Deactivate", where: "record", call: ["DELETE", "/zone/{id}"], confirm: true, danger: true, show: (zone) => own(zone) && !zone.deactivated, text: "The zone stops raising alarms. WildlifeNL has no way to switch a zone on again; draw a new one instead." },
  ],
  reports: [
    {
      label: "Add report",
      where: "list",
      call: ["POST", "/interaction/"],
      defaults: () => ({ moment: now() }),
      // the API asks for the details that belong to the type: 1 sighting, 2 damage, 3 collision
      when: { reportOfSighting: (values) => values.typeID === "1", reportOfDamage: (values) => values.typeID === "2", reportOfCollision: (values) => values.typeID === "3" },
      text: "A report of your own: a sighting, damage or a collision. Location is where you were, place is where it happened.",
      // the report shows on the live map, and a running experiment may have questions about it
      after: async (report) => {
        await loadOwnReports(true);
        if (report && report.questionnaire) await answerReport(report);
      },
    },
    { label: "Answer the questions", where: "record", call: ["POST", "/response/"], run: answerReport, show: (report) => own(report) && Boolean(report.questionnaire) },
  ],
  "report-types": [
    { label: "Add report type", where: "list", call: ["POST", "/interactionType/"] },
    { label: "Edit", where: "record", call: ["PUT", "/interactionType/{id}"], edit: true },
  ],
  experiments: [
    { label: "Add experiment", where: "list", call: ["POST", "/experiment/"], after: reloadPeople },
    { label: "Edit", where: "record", call: ["PUT", "/experiment/{id}"], edit: true, show: own, text: "WildlifeNL only changes an experiment that has not started yet." },
    { label: "Add questionnaire", where: "record", call: ["POST", "/questionnaire/"], preset: (experiment) => ({ experimentID: experiment.ID }), show: own, text: "WildlifeNL only takes a questionnaire for an experiment that has not started yet." },
    { label: "Add message", where: "record", call: ["POST", "/message/"], preset: (experiment) => ({ experimentID: experiment.ID }), show: own, text: "The trigger decides which fields are needed: an encounter needs the species, the metres and the minutes; an answer needs the answer option; an alarm needs the species." },
    { label: "End now", where: "record", call: ["PUT", "/experiment/end/{id}"], confirm: true, show: (experiment) => own(experiment) && !(Date.parse(experiment.end) <= Date.now()), text: "The experiment ends at once. Its questionnaires and messages are no longer sent." },
    { label: "Delete", where: "record", call: ["DELETE", "/experiment/{id}"], needs: SCOPES.research, confirm: true, danger: true, gone: true, show: own, after: reloadPeople, text: "The experiment is removed from WildlifeNL. This cannot be undone." },
  ],
  questionnaires: [
    { label: "Edit", where: "record", call: ["PUT", "/questionnaire/{id}"], edit: true, show: own },
    { label: "Add question", where: "record", call: ["POST", "/question/"], preset: (questionnaire) => ({ questionnaireID: questionnaire.ID }), show: own },
    { label: "Delete", where: "record", call: ["DELETE", "/questionnaire/{id}"], needs: SCOPES.research, confirm: true, danger: true, gone: true, show: own, text: "The questionnaire is removed from WildlifeNL. This cannot be undone." },
  ],
  questions: [
    { label: "Add answer option", where: "record", call: ["POST", "/answer/"], preset: (question) => ({ questionID: question.ID }) },
    { label: "Delete", where: "record", call: ["DELETE", "/question/{id}"], needs: SCOPES.research, confirm: true, danger: true, gone: true, text: "The question is removed from WildlifeNL. This cannot be undone." },
  ],
  answers: [{ label: "Delete", where: "record", call: ["DELETE", "/answer/{id}"], needs: SCOPES.research, confirm: true, danger: true, gone: true, text: "The answer option is removed from WildlifeNL. This cannot be undone." }],
  messages: [{ label: "Delete", where: "record", call: ["DELETE", "/message/{id}"], needs: SCOPES.research, confirm: true, danger: true, gone: true, text: "The message is removed from WildlifeNL. This cannot be undone." }],
  people: [
    { label: "Add person", where: "list", call: ["POST", "/user/"], text: "Makes an account for this email address. The person signs in with a code sent to it." },
    { label: "Give a role", where: "record", call: ["POST", "/role/"], preset: (person) => ({ userID: person.ID }), text: "WildlifeNL can take a while before it honours a changed role." },
    { label: "Take a role away", where: "record", call: ["PUT", "/role/"], preset: (person) => ({ userID: person.ID }), choices: { roleID: (person) => person.roles || [] }, show: (person) => (person.roles || []).length > 0, text: "WildlifeNL can take a while before it honours a changed role." },
  ],
  animals: [
    { label: "Add animal", where: "list", call: ["POST", "/animal/"], text: "The animal shows in the list of animals once a sensor is on it." },
    { label: "Put a sensor on this animal", where: "record", call: ["POST", "/borne-sensor-deployment/"], preset: (animal) => ({ animalID: animal.ID }), defaults: () => ({ start: now() }), after: () => loadSensors(true), text: "A sensor is on one animal at a time: an earlier deployment of this sensor ends at the start you give here." },
  ],
  account: [{ label: "Edit profile", where: "record", call: ["PUT", "/profile/me/"], edit: true, hide: ["firebaseCloudMessagingToken"] }],
};

/** Which kind of record a field of a form picks from, by the name of the field. */
const REFERS = { speciesID: "species", livingLabID: "livinglabs", typeID: "report-types", interactionTypeID: "report-types", experimentID: "experiments", questionnaireID: "questionnaires", questionID: "questions", nextQuestionID: "questions", answerID: "answers", zoneID: "zones", roleID: "roles" };
/** Names of fields that read better than the API's own. */
const LABELS = { nextQuestionID: "Next question", definition: "Area" };
/** The order of a form: what is typed or picked first, then the places, then the details. */
const RANK = { point: 1, outline: 1, group: 2, list: 2 };

/** Whether this app makes the call, for the table on the Account page: through an action, or
 * as the position that sharing.js sends. */
export function inApp(method, path) {
  return (method === "POST" && path === "/tracking-reading/") || Object.values(ACTIONS).some((actions) => actions.some((action) => action.call[0] === method && action.call[1] === path));
}

function allowed(action) {
  const operation = operationOf(...action.call);
  return Boolean(operation) && hasScope(operation.roles.length ? operation.roles : action.needs || []);
}

/** The actions of a kind that this account may do here. `record` is the record of the page,
 * or null above a list. */
export async function actionsFor(kind, where, record = null) {
  await loadApi();
  return (ACTIONS[kind] || []).filter((action) => action.where === where && allowed(action) && (!action.show || action.show(record)));
}

/** The lists a form picks from: per field the records of the kind it refers to. A list that
 * cannot be read leaves a field to type the ID in. */
async function choicesOf(fields, action, record) {
  const choices = {};
  await Promise.all(
    fields.map(async (field) => {
      const type = REFERS[field.name];
      if (LABELS[field.name]) field.label = LABELS[field.name];
      if (!type) return;
      let records = [];
      try {
        records = action.choices && action.choices[field.name] ? action.choices[field.name](record) : (await listRecords(type)).records;
      } catch (error) {
        if (error.status === 401) throw error;
      }
      if (!LABELS[field.name]) field.label = TYPES[type].label;
      if (records.length) choices[field.name] = records.map((item) => ({ value: item.ID, label: titleOf(type, item) })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    }),
  );
  return choices;
}

/** Asks for the fields of an action, or to confirm it, and makes the call. Resolves to
 * `{result}` with what WildlifeNL answered, or to null when the person cancelled. */
export async function runAction(kind, action, record = null) {
  if (action.run) {
    const result = await action.run(record);
    return result ? { result } : null;
  }
  const document = await loadApi();
  const [method, template] = action.call;
  const operation = operationOf(method, template);
  const preset = action.preset ? action.preset(record) : {};
  const hidden = action.hide || [];
  const fields = (operation.body && !action.confirm ? formFields(document, operation.body) : []).filter((field) => !(field.name in preset) && !hidden.includes(field.name)).sort((a, b) => (RANK[a.kind] || 0) - (RANK[b.kind] || 0));
  const kept = Object.fromEntries(hidden.filter((name) => record && record[name] != null).map((name) => [name, record[name]]));
  const path = template.replace("{id}", encodeURIComponent(record ? record.ID : ""));
  const done = await openForm({
    title: action.label,
    subtitle: record ? (TYPES[kind] ? titleOf(kind, record) : record.name || "") : "",
    text: action.text || "",
    fields,
    values: { ...(action.defaults ? action.defaults() : {}), ...(action.edit ? formValues(fields, record) : {}) },
    choices: await choicesOf(fields, action, record),
    when: action.when || {},
    submit: action.confirm ? action.label : action.edit ? "Save" : action.label,
    danger: Boolean(action.danger),
    send: (body) => account.api.call(method, path, operation.body ? { ...kept, ...body, ...preset } : undefined),
  });
  if (!done) return null;
  // what the app remembered of the record is out of date now
  if (record && TYPES[kind]) forget(kind, record.ID);
  const { result } = done;
  if (result && result.ID != null && TYPES[kind] && (!record || String(result.ID) === String(record.ID))) remember(kind, result);
  if (action.after) await action.after(result);
  return done;
}

/**
 * Draws a button per action the account may do into `target`.
 * @param record the record of the page, null above a list, or a function that fetches it
 * @param after runs after an action succeeded, with what WildlifeNL answered and the action
 */
export async function drawActions(target, kind, where, record, after) {
  const mine = (target.run = (target.run || 0) + 1);
  target.replaceChildren();
  let actions;
  try {
    actions = await actionsFor(kind, where, typeof record === "function" ? null : record);
  } catch (error) {
    // without the API's description there is nothing to offer; reading goes on
    const text = explain(error);
    if (text) toast(`Could not read what your account may change: ${text}`, true);
    return;
  }
  if (target.run !== mine) return;
  target.replaceChildren(
    ...actions.map((action) =>
      el("button", {
        class: `btn ${action.danger ? "destructive" : action.where === "list" ? "primary" : "outline"}`,
        type: "button",
        text: action.label,
        onclick: (event) =>
          busy(event.currentTarget, async () => {
            try {
              const done = await runAction(kind, action, typeof record === "function" ? await record() : record);
              if (!done) return;
              toast(action.gone ? "Removed from WildlifeNL" : "Saved in WildlifeNL");
              await after(done.result, action);
            } catch (error) {
              const text = explain(error);
              if (text) toast(text, true);
            }
          }),
      }),
    ),
  );
}
