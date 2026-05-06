class ProviderAdapterInterface {
  getProviderInfo() {
    throw new Error('Not implemented');
  }

  fetchDestinations() {
    throw new Error('Not implemented');
  }

  fetchParks(_destinationId) {
    throw new Error('Not implemented');
  }

  fetchEntities(_parkId) {
    throw new Error('Not implemented');
  }

  fetchEntity(_entityId) {
    throw new Error('Not implemented');
  }

  fetchEntityLive(_entityId) {
    throw new Error('Not implemented');
  }

  fetchEntitySchedule(_entityId, _options = {}) {
    throw new Error('Not implemented');
  }

  fetchLiveData(_parkId) {
    throw new Error('Not implemented');
  }

  fetchCalendar(_parkId, _options = {}) {
    throw new Error('Not implemented');
  }

  normalizeToCanonicalMessages(_input) {
    throw new Error('Not implemented');
  }
}

module.exports = { ProviderAdapterInterface };
