const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildCanonicalUnsTopic, slugifyName } = require('./uns-topic-generator.service');
const {
  normalizeThemeParksEntityType,
  resolveThemeParksPublicationDomain,
  mergeThemeParksEntityRegistryFromMessages,
  getRegisteredEntityRow,
  getRegisteredEntityRowForSparkplugLookup,
} = require('./theme-parks-entity-domain.service');

describe('normalizeThemeParksEntityType', () => {
  it('maps core ThemeParks hierarchy types to UNS domains', () => {
    assert.equal(normalizeThemeParksEntityType('RESTAURANT'), 'restaurants');
    assert.equal(normalizeThemeParksEntityType('ATTRACTION'), 'rides');
    assert.equal(normalizeThemeParksEntityType('SHOW'), 'shows');
    assert.equal(normalizeThemeParksEntityType('PARK'), 'parks');
    assert.equal(normalizeThemeParksEntityType('DESTINATION'), 'destinations');
  });

  it('falls back to entities for unknown types', () => {
    assert.equal(normalizeThemeParksEntityType('OTHER'), 'entities');
    assert.equal(normalizeThemeParksEntityType(null), 'entities');
  });
});

describe('resolveThemeParksPublicationDomain', () => {
  it('uses only entityType, never name heuristics', () => {
    assert.equal(resolveThemeParksPublicationDomain('Café de Paris', 'RESTAURANT'), 'restaurants');
    assert.equal(resolveThemeParksPublicationDomain('Café de Paris', null), 'entities');
    assert.equal(resolveThemeParksPublicationDomain('Some Food Name', null), 'entities');
  });
});

describe('canonical UNS topic domain (examples)', () => {
  it('Café de Paris → restaurants', () => {
    const domain = resolveThemeParksPublicationDomain('Café de Paris', 'RESTAURANT');
    assert.equal(domain, 'restaurants');
    const entitySlug = slugifyName('Café de Paris');
    assert.equal(
      buildCanonicalUnsTopic({
        parkSlug: 'europa_park',
        entityType: domain,
        entitySlug,
        metric: 'status',
      }),
      `tpuns/europa_park/v1/restaurants/${entitySlug}/status`
    );
  });

  it('Euro-Mir → rides', () => {
    const domain = resolveThemeParksPublicationDomain('Euro-Mir', 'ATTRACTION');
    assert.equal(domain, 'rides');
    assert.equal(
      buildCanonicalUnsTopic({
        parkSlug: 'europa_park',
        entityType: domain,
        entitySlug: 'euro_mir',
        metric: 'status',
      }),
      'tpuns/europa_park/v1/rides/euro_mir/status'
    );
  });

  it("Surpr'Ice presents a Christmas Dream → shows", () => {
    const domain = resolveThemeParksPublicationDomain("Surpr'Ice presents a Christmas Dream", 'SHOW');
    assert.equal(domain, 'shows');
    const slug = slugifyName("Surpr'Ice presents a Christmas Dream");
    assert.equal(
      buildCanonicalUnsTopic({
        parkSlug: 'europa_park',
        entityType: domain,
        entitySlug: slug,
        metric: 'status',
      }),
      'tpuns/europa_park/v1/shows/surpr_ice_presents_a_christmas_dream/status'
    );
  });

  it('Europa-Park → parks', () => {
    const domain = resolveThemeParksPublicationDomain('Europa-Park', 'PARK');
    assert.equal(domain, 'parks');
    assert.equal(
      buildCanonicalUnsTopic({
        parkSlug: 'europa_park',
        entityType: domain,
        entitySlug: 'europa_park',
        metric: 'status',
      }),
      'tpuns/europa_park/v1/parks/europa_park/status'
    );
  });

  it('Destination Europa-Park Resort → destinations', () => {
    const domain = resolveThemeParksPublicationDomain('Europa-Park Resort', 'DESTINATION');
    assert.equal(domain, 'destinations');
    assert.equal(
      buildCanonicalUnsTopic({
        parkSlug: 'europa_park',
        entityType: domain,
        entitySlug: slugifyName('Europa-Park Resort'),
        metric: 'status',
      }),
      'tpuns/europa_park/v1/destinations/europa_park_resort/status'
    );
  });
});

describe('mergeThemeParksEntityRegistryFromMessages', () => {
  it('stores domain from entityType for PARK_ENTITY_SYNCED', () => {
    const gid = `test_registry_${Date.now()}`;
    mergeThemeParksEntityRegistryFromMessages({
      sparkplugGroupId: gid,
      parkExternalId: 'park-ext-1',
      destinationExternalId: 'dest-ext-1',
      messages: [
        {
          messageType: 'PARK_ENTITY_SYNCED',
          externalEntityId: 'ent-1',
          entityType: 'RESTAURANT',
          payload: {
            id: 'ent-1',
            name: 'Café de Paris',
            slug: 'cafe_de_paris',
            entityType: 'RESTAURANT',
            parentId: 'park-ext-1',
            externalId: 'ent-1',
          },
        },
      ],
    });
    const r = getRegisteredEntityRow(gid, 'cafe_de_paris');
    assert.ok(r);
    assert.equal(r.domain, 'restaurants');
    assert.equal(r.entityType, 'RESTAURANT');
    assert.equal(r.parentSlug, slugifyName(gid));
  });
});

describe('getRegisteredEntityRowForSparkplugLookup (UNS Live)', () => {
  function parkEntityMsg(id, name, slug, entityType, parentParkId) {
    return {
      messageType: 'PARK_ENTITY_SYNCED',
      externalEntityId: id,
      entityType,
      payload: {
        id,
        name,
        slug,
        entityType,
        parentId: parentParkId,
        externalId: id,
      },
    };
  }

  it('resolves Langnese Happiness Station as RESTAURANT → restaurants', () => {
    const gid = `live_lookup_${Date.now()}`;
    const parkId = 'park-ep-1';
    mergeThemeParksEntityRegistryFromMessages({
      sparkplugGroupId: gid,
      parkExternalId: parkId,
      destinationExternalId: 'dest-1',
      messages: [
        parkEntityMsg('x1', 'Langnese Happiness Station Greece', 'langnese_happiness_station_greece', 'RESTAURANT', parkId),
      ],
    });
    const row = getRegisteredEntityRowForSparkplugLookup(gid, 'langnese_happiness_station_greece');
    assert.ok(row);
    assert.equal(row.domain, 'restaurants');
    assert.equal(
      buildCanonicalUnsTopic({
        parkSlug: 'europa_park',
        entityType: row.domain,
        entitySlug: 'langnese_happiness_station_greece',
        metric: 'status',
      }),
      'tpuns/europa_park/v1/restaurants/langnese_happiness_station_greece/status'
    );
  });

  it('euro_mir ATTRACTION → rides; cafe_de_paris RESTAURANT → restaurants; esencia_flamenca SHOW → shows', () => {
    const gid = `live_lookup_multi_${Date.now()}`;
    const parkId = 'park-2';
    mergeThemeParksEntityRegistryFromMessages({
      sparkplugGroupId: gid,
      parkExternalId: parkId,
      destinationExternalId: null,
      messages: [
        parkEntityMsg('a1', 'Euro-Mir', 'euro_mir', 'ATTRACTION', parkId),
        parkEntityMsg('a2', 'Café de Paris', 'cafe_de_paris', 'RESTAURANT', parkId),
        parkEntityMsg('a3', 'Esencia Flamenca', 'esencia_flamenca', 'SHOW', parkId),
      ],
    });
    const cases = [
      ['euro_mir', 'rides', 'tpuns/europa_park/v1/rides/euro_mir/status'],
      ['cafe_de_paris', 'restaurants', 'tpuns/europa_park/v1/restaurants/cafe_de_paris/status'],
      ['esencia_flamenca', 'shows', 'tpuns/europa_park/v1/shows/esencia_flamenca/status'],
    ];
    for (const [slug, domain, topic] of cases) {
      const row = getRegisteredEntityRowForSparkplugLookup(gid, slug);
      assert.ok(row, slug);
      assert.equal(row.domain, domain, slug);
      assert.equal(
        buildCanonicalUnsTopic({
          parkSlug: 'europa_park',
          entityType: row.domain,
          entitySlug: slug,
          metric: 'status',
        }),
        topic
      );
    }
  });
});
