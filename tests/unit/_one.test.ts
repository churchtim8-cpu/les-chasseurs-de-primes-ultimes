import { it } from 'vitest';
import { BELLEVUE } from '../../src/content/map/bellevue';
import { Chase } from '../../src/engine/chase/chase';
import { generateScenario } from '../../src/engine/chase/scenario';
import { TownGraph } from '../../src/engine/world/graph';
import { ListenerBot } from './listenerBot';
const graph = new TownGraph(BELLEVUE);
it('one', () => { (globalThis as any).DBG = process.env.DBG ? 1 : 0;
  const opts: any = process.env.CT ? { chaseType: process.env.CT as any } : {}; if (process.env.TO) opts.turnOff = true;
  const chase = new Chase(graph, generateScenario(graph, process.env.SEED!, opts));
  console.log('type', chase.scenario.chaseType, 'turnOff', JSON.stringify(chase.scenario.turnOff), 'near', chase.scenario.nearCapture, 'lost', chase.scenario.lostSignal, 'sightings', chase.scenario.sightings.length);
  const bot = new ListenerBot(graph);
  let from = '';
  for (let t = 0; t < 400 && chase.status.phase === 'PURSUIT'; t += 0.05) {
    const evs = bot.step(chase, 0.05);
    const here = chase.player.location();
    const p = `@${here.edgeId}>${here.towards} ${chase.player.mode} t=${t.toFixed(2)}`;
    for (const e of evs) {
      if (e.type === 'TRANSMISSION') console.log(bot.now.toFixed(2), e.transmission.kind, e.transmission.text, e.transmission.instructions.map((i) => i.atNodes.join(',')).join('|'), p);
      else if (e.type === 'ANNOUNCE' || e.type === 'SIGHTING' || (e.type === 'WARNING' && e.speak) || e.type === 'SIGNAL' || e.type === 'SUSPECT_MODE') console.log(bot.now.toFixed(2), e.type, JSON.stringify(e).slice(0, 140), p);
    }
    const origin = graph.other(graph.edge(here.edgeId), here.towards);
    if (origin !== from && process.env.NODES) console.log('   pass', origin, t.toFixed(2));
    from = origin;
  }
  console.log(chase.status.phase, chase.status.timeLeft);
});
