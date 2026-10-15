import { massagePadWeight, massagePulse } from './massage.js';
import { T12_MASSAGE_LAYOUT as D } from './dimensions.js';

// Fixed textile coordinates have fixed spatial influence. Only the pad lift changes.
export class MassageSurfaceCache {
  constructor(channels, points) {
    this.pads = channels.flatMap((channel) =>
      channel.pads.map((pad, row) => ({ pad, channel, row })),
    );
    const count = this.pads.length;
    this.weights = Float64Array.from({ length: points.length * count }, (_, i) => {
      const point = points[Math.floor(i / count)];
      return massagePadWeight(this.pads[i % count].pad, point.x, point.z);
    });
    this.heights = new Float64Array(points.length);
    this.lifts = new Float64Array(count);
  }
  update(lanes) {
    for (let k = 0; k < this.pads.length; k++) {
      const { channel, row } = this.pads[k],
        lane = lanes?.[channel.id];
      this.lifts[k] = lane?.amount
        ? D.lift * lane.amount * lane.intensity * massagePulse(lane.phase, row, channel.pads.length)
        : 0;
    }
    for (let i = 0; i < this.heights.length; i++) {
      let height = 0;
      for (let k = 0; k < this.pads.length; k++)
        height += this.weights[i * this.pads.length + k] * this.lifts[k];
      this.heights[i] = height;
    }
    return this.heights;
  }
}
