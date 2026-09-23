import analystImg from '@/assets/agents/research-analyst.jpg';
import designerImg from '@/assets/agents/designer.jpg';
import filesImg from '@/assets/agents/files-agent.jpg';
import opsImg from '@/assets/agents/ops-coordinator.jpg';
import writerImg from '@/assets/agents/writer.png';
import productCoachImg from '@/assets/agents/product-coach.png';
import librarianImg from '@/assets/agents/knowledge-librarian.png';
import marketingImg from '@/assets/agents/marketing-strategist.png';

/** Painted portraits for the core team; everyone else gets a drawn portrait. */
export const AVATARS: Readonly<Record<string, string>> = {
  'research-analyst': analystImg,
  designer: designerImg,
  'files-agent': filesImg,
  'ops-coordinator': opsImg,
  writer: writerImg,
  'product-coach': productCoachImg,
  'knowledge-librarian': librarianImg,
  'marketing-strategist': marketingImg
};
