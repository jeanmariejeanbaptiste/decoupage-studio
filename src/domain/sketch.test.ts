import { describe, expect, it } from 'vitest';
import { arrow3dFaces, arrowHead, shadeColor } from './sketch';

describe('flèches du storyboard', () => {
  it('flèche 3D : faces extrudées, projetées et ordonnées de l’arrière vers l’avant', () => {
    const faces = arrow3dFaces({ yaw: 0, pitch: 25, roll: 0 });
    expect(faces).toHaveLength(2 + 7);
    // Courbée : le contour se subdivise, la flèche reste centrée.
    const bent = arrow3dFaces({ yaw: 0, pitch: 0, roll: 0, bend: 90, length: 1.5 });
    expect(bent.length).toBeGreaterThan(20);
    const xs = faces.flatMap((f) => f.points.map((p) => p[0]));
    expect(Math.max(...xs)).toBeGreaterThan(0.45); // pointe vers la droite
    // Vers la caméra : la pointe grossit (perspective) et descend à l'écran.
    const toward = arrow3dFaces({ yaw: -90, pitch: 30, roll: 0 });
    const ys = toward.flatMap((f) => f.points.map((p) => p[1]));
    expect(Math.max(...ys)).toBeGreaterThan(0.25);
    faces.forEach((f) => expect(f.shade).toBeGreaterThanOrEqual(0.45));
  });
  it('pointe 2D et teintes', () => {
    const head = arrowHead([0, 0], [100, 0], 20);
    expect(head[0]).toEqual([100, 0]);
    expect(head[1][0]).toBeLessThan(100);
    expect(shadeColor('#808080', 0.5)).toBe('#404040');
  });
});
