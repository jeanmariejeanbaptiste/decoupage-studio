import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { cleanAddress, dayPlaces, geocodeQueries, geoKey, mapPlaces, markerLabel, nominatimUrl, parseNominatim, placeCoords, routeUrl, setGeocode, storedGeocode } from './geo';
import { callSheetDocument } from './documents';
import { setDecorLocation } from './locations';
import { assignShots, updateDay } from './schedule';

function project() {
  const base = buildFiction();
  const [s1, s2, s3] = base.project.sequenceIds;
  return produce(base, (d) => {
    assignShots(d, [...d.sequences[s1].shotIds, ...d.sequences[s2].shotIds], 1);
    assignShots(d, d.sequences[s3].shotIds, 2);
    setDecorLocation(d, d.sequences[s1].decorId!, { name: 'Gare de Lyon', address: '20 bd Diderot, 75012 Paris' });
    updateDay(d, 1, { hospital: 'Hôpital Saint-Antoine, 184 rue du Faubourg Saint-Antoine, 75012 Paris, tél. 01 49 28 20 00' });
    updateDay(d, 2, { seqAddresses: { [s3]: '20 BD Diderot 75012 Paris.' } });
  });
}

describe('carte des lieux de tournage', () => {
  it('normalise une adresse : casse, accents, espaces, ponctuation finale', () => {
    expect(geoKey('  20 Bd  Diderot ,75012 Paris. ')).toBe('20 bd diderot 75012 paris');
    expect(geoKey('Hôtel-Dieu')).toBe(geoKey('hotel-dieu'));
  });

  it('retire le téléphone d’un champ libre, sans toucher au code postal ni aux noms', () => {
    expect(cleanAddress('Hôpital Saint-Antoine, 184 rue du Faubourg Saint-Antoine, 75012 Paris, tél. 01 49 28 20 00')).toBe('Hôpital Saint-Antoine, 184 rue du Faubourg Saint-Antoine, 75012 Paris');
    expect(cleanAddress('Hôtel-Dieu, 1 parvis Notre-Dame, 75004 Paris — +33 1 42 34 82 34')).toBe('Hôtel-Dieu, 1 parvis Notre-Dame, 75004 Paris');
    expect(cleanAddress('3 quai Voltaire')).toBe('3 quai Voltaire');
  });

  it('rassemble les lieux : décors, adresses du jour, hôpital, décors non planifiés', () => {
    const doc = project();
    const [s1, , s3] = doc.project.sequenceIds;
    const places = mapPlaces(doc);
    const gare = places.find((p) => p.key === geoKey('20 bd Diderot, 75012 Paris'));
    // Même adresse (écrite autrement) le jour 2 : un seul repère, deux jours.
    expect(gare?.days).toEqual([1, 2]);
    expect(gare?.names).toContain('Gare de Lyon');
    const hosp = places.find((p) => p.kind === 'hopital');
    expect(hosp).toMatchObject({ address: 'Hôpital Saint-Antoine, 184 rue du Faubourg Saint-Antoine, 75012 Paris', names: ['Hôpital Saint-Antoine'], days: [1] });
    expect(geocodeQueries(hosp!)).toEqual([hosp!.address, '184 rue du Faubourg Saint-Antoine, 75012 Paris']);
    expect(dayPlaces(places, doc, 1).map((p) => p.kind)).toEqual(['lieu', 'hopital']);
    expect(markerLabel(gare!)).toBe('1·2');
    expect(markerLabel(gare!, 2)).toBe('2');
    expect(markerLabel(hosp!, 1)).toBe('H');
    expect(markerLabel({ ...gare!, days: [1, 2, 3, 5] })).toBe('1·…·5');
    // Un décor non planifié garde son repère, sans jour.
    const later = produce(doc, (d) => {
      assignShots(d, d.sequences[s3].shotIds, undefined);
      updateDay(d, 2, { seqAddresses: {} });
      setDecorLocation(d, d.sequences[s3].decorId!, { address: '1 rue de Belleville, Paris' });
    });
    const free = mapPlaces(later).find((p) => p.address === '1 rue de Belleville, Paris');
    expect(free?.days).toEqual([]);
    expect(markerLabel(free!)).toBe('');
    void s1;
  });

  it('lit Nominatim et construit les liens', () => {
    expect(nominatimUrl('20 bd Diderot, Paris')).toBe('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=20%20bd%20Diderot%2C%20Paris');
    expect(parseNominatim([{ lat: '48.8443', lon: '2.3744', display_name: 'x' }])).toEqual({ lat: 48.8443, lon: 2.3744 });
    expect(parseNominatim([])).toBeNull();
    expect(parseNominatim({ error: 'x' })).toBeNull();
    expect(parseNominatim([{ lat: 'a', lon: '2' }])).toBeNull();
    expect(routeUrl('20 bd Diderot', { address: '20 bd Diderot', lat: 48.844312, lon: 2.374412 })).toBe('https://www.openstreetmap.org/directions?route=%3B48.84431%2C2.37441#map=16/48.84431/2.37441');
    expect(routeUrl('20 bd Diderot', { address: '20 bd Diderot', missing: true })).toBe('https://www.openstreetmap.org/search?query=20%20bd%20Diderot');
    expect(placeCoords({ address: 'x', missing: true })).toBeUndefined();
  });

  it('l’export de la feuille de service garde un lien d’itinéraire par lieu', () => {
    const doc = project();
    const key = geoKey('20 bd Diderot, 75012 Paris');
    const html = callSheetDocument(doc, 1).html;
    // Pas encore géocodé : recherche de l'adresse ; puis itinéraire vers ses coordonnées.
    expect(html).toContain('href="https://www.openstreetmap.org/search?query=20%20bd%20Diderot%2C%2075012%20Paris">Itinéraire</a>');
    expect(html).toContain('href="https://www.openstreetmap.org/search?query=H%C3%B4pital%20Saint-Antoine%2C%20184%20rue%20du%20Faubourg%20Saint-Antoine%2C%2075012%20Paris">Itinéraire</a>');
    const geo = produce(doc, (d) => setGeocode(d, key, { address: '20 bd Diderot, 75012 Paris', lat: 48.8443, lon: 2.3744 }));
    expect(callSheetDocument(geo, 1).html).toContain('href="https://www.openstreetmap.org/directions?route=%3B48.8443%2C2.3744#map=16/48.8443/2.3744">Itinéraire</a>');
  });

  it('garde le géocodage dans le projet, pour les seules adresses encore utilisées', () => {
    const doc = project();
    const key = geoKey('20 bd Diderot, 75012 Paris');
    const a = produce(doc, (d) => setGeocode(d, key, { address: '20 bd Diderot, 75012 Paris', lat: 48.8443123, lon: 2.3744 }));
    expect(a.geocodes?.[key]).toEqual({ address: '20 bd Diderot, 75012 Paris', lat: 48.84431, lon: 2.3744 });
    expect(storedGeocode(a, '20 BD Diderot 75012 Paris.')?.lat).toBe(48.84431);
    // Même résultat : rien ne change.
    expect(produce(a, (d) => setGeocode(d, key, { address: '20 bd Diderot, 75012 Paris', lat: 48.84431, lon: 2.3744 }))).toBe(a);
    // Adresse inconnue du projet : ignorée.
    expect(produce(a, (d) => setGeocode(d, 'ailleurs', { address: 'ailleurs', missing: true }))).toBe(a);
    // L'adresse change : l'ancien résultat part quand le nouveau arrive.
    const [s1] = doc.project.sequenceIds;
    const moved = produce(a, (d) => {
      setDecorLocation(d, d.sequences[s1].decorId!, { address: '1 place Louis-Armand, Paris' });
      updateDay(d, 2, { seqAddresses: {} });
    });
    const k2 = geoKey('1 place Louis-Armand, Paris');
    const b = produce(moved, (d) => setGeocode(d, k2, { address: '1 place Louis-Armand, Paris', missing: true }));
    expect(Object.keys(b.geocodes ?? {})).toEqual([k2]);
    expect(b.geocodes?.[k2]).toEqual({ address: '1 place Louis-Armand, Paris', missing: true });
  });
});
