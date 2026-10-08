'use strict';

const { isDeepStrictEqual } = require('node:util');
const { runtimeId } = require('./record-ids');
const { requireCondition } = require('./errors');

function acceptanceInput(input) {
  if (input.handoverId !== undefined) runtimeId(input.handoverId, 'handoverId');
  return { handoverId: input.handoverId ?? null, controller: input.controller, authority: input.authority, objective: input.objective, tasks: input.tasks, limits: input.limits ?? {}, publication: input.publication ?? { authorized: false }, resources: input.resources ?? null };
}

function replayAcceptance(previous, input) {
  const accepted = acceptanceInput(input);
  if (!previous || accepted.handoverId === null || previous.acceptance?.handoverId !== accepted.handoverId) return false;
  requireCondition(isDeepStrictEqual(previous.acceptance, accepted), 'handover-conflict', 'This handover identity already binds different authority, scope, owner or resources');
  return true;
}

module.exports = { acceptanceInput, replayAcceptance };
