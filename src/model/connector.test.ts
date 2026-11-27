import { describe, expect, it } from 'vitest';
import { connectorStroke } from './connector';
import { MapDoc } from './doc';

describe('individual connector styling', () => {
  it('inherits unset attributes and bounds styles from imported maps', () => {
    expect(connectorStroke().strokeWidth).toBeUndefined();
    expect(connectorStroke({width:70,opacity:-1,color:'red'})).toMatchObject({strokeWidth:12,opacity:0.1,stroke:undefined});
    expect(connectorStroke({pattern:'solid'}).strokeDasharray).toBe('none');
    expect(connectorStroke({pattern:'dashed'}).strokeDasharray).toBe('7 5');
    expect(connectorStroke({width:5,pattern:'dotted'})).toMatchObject({strokeLinecap:'round',strokeDasharray:'0.1 10'});
  });
  it('round trips styled relationships and preserves them when duplicating a subtree', () => {
    const doc = new MapDoc();
    const root = doc.addRoot('Conclusion',0,0);
    const g = doc.addGroup(root,'reason','First')!;
    const second = doc.addPremise(g.groupId,undefined,'Second')!;
    const style = {color:'#345678',width:4,opacity:0.6,pattern:'dotted' as const};
    doc.update(g.groupId,{connector:style});
    doc.addConnection(g.premiseId,second,style);
    const restored = new MapDoc();
    restored.restore(doc.toFile());
    expect(restored.get(g.groupId)?.connector).toEqual(style);
    expect(restored.allConnections()[0].connector).toEqual(style);
    const [copy] = restored.paste(restored.copy([root]),null);
    expect(restored.children(copy)[0].connector).toEqual(style);
    expect(restored.allConnections().map(c=>c.connector)).toEqual([style,style]);
    restored.update(g.groupId,{connector:undefined});
    restored.undo.undo();
    expect(restored.get(g.groupId)?.connector).toEqual(style);
  });
});
