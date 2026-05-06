function jsonSnapshot(model) {
  if (!model) return null;
  try {
    return typeof model.toJSON === 'function' ? model.toJSON() : { ...model };
  } catch {
    return null;
  }
}

module.exports = { jsonSnapshot };
