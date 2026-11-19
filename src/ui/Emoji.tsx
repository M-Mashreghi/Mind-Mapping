import thumbs from '../assets/emoji/1f44d.svg?url';
import clap from '../assets/emoji/1f44f.svg?url';
import party from '../assets/emoji/1f973.svg?url';
import joy from '../assets/emoji/1f602.svg?url';
import cool from '../assets/emoji/1f60e.svg?url';
import heart from '../assets/emoji/2764.svg?url';
import thinking from '../assets/emoji/1f914.svg?url';
import question from '../assets/emoji/2753.svg?url';
import smile from '../assets/emoji/1f60a.svg?url';

/**
 * Reactions drawn from bundled Twemoji graphics, not the system emoji font: on Windows
 * that font is flat and blurry at small sizes and sits unevenly next to text.
 */
const ART: Record<string, string> = {
  '👍': thumbs, '👏': clap, '🥳': party, '😂': joy, '😎': cool, '❤️': heart, '❤': heart, '🤔': thinking, '❓': question, '😊': smile,
};

export function Emoji({ e, size = 16 }: { e: string; size?: number }) {
  const src = ART[e];
  if (!src) return <span className="emoji-text" style={{ fontSize: size }}>{e}</span>;
  return <img className="emoji" src={src} alt={e} width={size} height={size} draggable={false} />;
}
