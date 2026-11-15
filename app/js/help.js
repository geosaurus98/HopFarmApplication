// Help and reference content, split into Mite Monitoring and Plant Health.
// Built into the app (so it works offline and updates with the app). Extra items the
// farm adds in the HelpReference sheet tab are shown after these, in the section named
// in their Section column (blank = Mite Monitoring).
import { h } from './ui.js';
import { helpImageUrl } from './logic.js';

/** Built-in items. `steps` show one per line; `images` are shown large. */
export const MITE_HELP = [
  {
    id: 'mite-2sm', category: 'Identification', title: 'Two-spotted spider mite (2SM) — Tetranychus urticae',
    text: 'The pest. Adults about 0.5 mm, oval, pale yellow-green to straw coloured with two dark spots on the body. Usually on the underside of the leaf, often with fine webbing and pale speckled damage on the upper surface. Overwintering females can be orange-red — don’t confuse them with PP. Count every live adult and young mite as 2SM.',
    images: [['mites/two-spotted-mite.jpg', 'A two-spotted spider mite: pale body with two dark spots'], ['mites/two-spotted-mites.jpg', 'Two-spotted mites on a hop leaf']],
  },
  {
    id: 'mite-2sm-eggs', category: 'Identification', title: '2SM eggs',
    text: 'Tiny (about 0.13 mm), perfectly round, clear to pearly white when laid, turning creamy as they develop. Often among webbing on the leaf underside. Count them as 2SM eggs, not in the live count.',
  },
  {
    id: 'mite-dead-2sm', category: 'Identification', title: 'Dead 2SM',
    text: 'Two-spotted mites that are shrivelled, flattened, darkened or emptied and don’t move when touched — often sucked dry by predators. Count them as Dead 2SM, separately from live 2SM.',
  },
  {
    id: 'mite-eaten-eggs', category: 'Identification', title: 'Eaten 2SM eggs',
    text: '2SM eggs that are collapsed, empty or torn (just the shell left), usually because predators have fed on them. Count them as Eaten 2SM eggs, separately from healthy 2SM eggs.',
  },
  {
    id: 'mite-pp', category: 'Identification', title: 'Predatory mite (PP) — Phytoseiulus persimilis',
    text: 'The beneficial predator. Slightly larger than 2SM, bright orange-red, pear/teardrop shaped, no dark spots, long front legs and moves quickly. Count adults and young as PP.',
    images: [['mites/pp-eating-2sm.jpg', 'An orange predatory mite feeding on a two-spotted mite'], ['mites/pp-with-2sm.jpg', 'A predatory mite next to two-spotted mites']],
  },
  {
    id: 'mite-pp-eggs', category: 'Identification', title: 'PP eggs (predator eggs)',
    text: 'Oval rather than round and roughly twice the size of 2SM eggs; pinkish-orange to pale when fresh. Count them as PP eggs.',
  },
  {
    id: 'mite-ladybird', category: 'Identification', title: 'Ladybirds (including Stethorus)',
    text: 'Stethorus is a very small (about 1.5 mm) shiny black ladybird whose adults and larvae eat spider mites. Larger ladybirds and their larvae may also be present. Count them under Beneficials — Ladybird (Stethorus) or Ladybird (other).',
    images: [['mites/ladybird.jpg', 'A ladybird on a leaf']],
  },
  {
    id: 'mite-lacewing', category: 'Identification', title: 'Lacewings',
    text: 'Green or brown lacewing larvae are long with large curved jaws; adults have lacy see-through wings; eggs sit on fine stalks. Count them under Beneficials — Lacewing.',
    images: [['mites/lacewing.jpg', 'An adult lacewing']],
  },
  {
    id: 'mite-thrips', category: 'Identification', title: 'Predatory thrips and other beneficials',
    text: 'Predatory thrips are slender and dark. Other beneficials include predatory midge larvae (orange maggots in mite colonies), predatory bugs and spiders. Count each under its own Beneficials line; use Other and describe it if it isn’t listed. If unsure, add a leaf comment and photo.',
    images: [['mites/predatory-thrips.jpg', 'A predatory thrips']],
  },
  {
    id: 'mite-damage', category: 'Identification', title: 'Spider mite damage on the leaf',
    text: 'Fine pale speckling (stippling) on the upper surface of the leaf, yellowing and bronzing, and webbing underneath. Heavy damage reduces photosynthesis and plant growth.',
    images: [['mites/leaf-damage.jpg', 'A hop leaf with pale speckled mite damage']],
  },
  {
    id: 'mite-collect', category: 'How to', title: 'Collecting a sample in the field',
    steps: [
      'Before you go out, open the app on Wi-Fi and check the badge at the top says "All synced". This is the only step that needs Wi-Fi.',
      'In the field — no signal needed from here on.',
      'Tap Mite Monitoring, then New Mite Sample.',
      'Enter the number written on the bag.',
      'Choose the block and variety.',
      'Add comments or photos if something is unusual.',
      'Tap Continue.',
      'Collect the number of leaves shown, seal the bag and check it is clearly labelled.',
      'Tap Record another sample for the next block.',
      'Back in Wi-Fi, the samples upload by themselves.',
    ],
  },
  {
    id: 'mite-analyse', category: 'How to', title: 'Analysing a sample in the office',
    steps: [
      'Tap Mite Monitoring, then Analyse Samples, and choose the sample.',
      'Check the bag number matches.',
      'Tap Start analysis.',
      'Enter the counts for the leaf. Every box starts at 0 — only change the ones you see.',
      'Tap Next leaf. The next leaf opens straight away.',
      'When the bag is done, tap Sample finished.',
      'Tap Complete analysis. If you did fewer leaves than the target, choose the reason.',
    ],
  },
  {
    id: 'mite-zero', category: 'How to', title: 'What 0 means',
    text: 'Every count starts at 0, which means "looked and found none". Change only the boxes for what you actually see on the leaf.',
  },
  {
    id: 'mite-sync', category: 'How to', title: 'Syncing and offline use',
    steps: [
      'The badge at the top shows how many changes are waiting to upload.',
      'They upload by themselves when the tablet has internet.',
      'To force it, tap the badge, then Sync now.',
      'Don’t clear the browser data or remove the app while changes are waiting.',
    ],
  },
];

export const PLANT_HELP = [
  ['nitrogen', 'Nitrogen deficiency'], ['phosphorus', 'Phosphorus deficiency'], ['potassium', 'Potassium deficiency'],
  ['calcium', 'Calcium deficiency'], ['magnesium', 'Magnesium deficiency'], ['sulphur', 'Sulphur deficiency'],
  ['boron', 'Boron deficiency'], ['chlorine', 'Chlorine deficiency'], ['copper', 'Copper deficiency'], ['iron', 'Iron deficiency'],
  ['manganese', 'Manganese deficiency'], ['molybdenum', 'Molybdenum deficiency'], ['zinc', 'Zinc deficiency'], ['hop-aphids', 'Hop aphids'],
].map(([file, title]) => ({
  id: `plant-${file}`, category: 'Identification', title,
  images: [[`plant/${file}.jpg`, `${title}: reference pictures`]],
})).concat([{
  id: 'plant-howto', category: 'How to', title: 'Doing a weekly plant check',
  steps: [
    'Tap Plant Health, then New Plant Check.',
    'Choose the block and variety, and enter the row and bay (counting from the south).',
    'Tap the choices for the block overview.',
    'Choose the current growth stage.',
    'Look at all 7 plants in the bay and fill in the vine evaluation.',
    'Tap Save plant check, then Check another bay.',
  ],
}]);

/** Items the farm added in the HelpReference sheet (built-in H01–H12 rows are superseded by the above). */
export function sheetHelp(rows, section) {
  return rows
    .filter((r) => !/^H\d{2}$/.test(String(r.HelpID)) && (String(r.Section || 'Mites').trim() || 'Mites') === section)
    .sort((a, b) => Number(a.SortOrder) - Number(b.SortOrder))
    .map((r) => ({
      id: `sheet-${r.HelpID}`, category: r.Category || 'Identification', title: r.Title, text: r.Description,
      images: helpImageUrl(r.Image) || /^help\//.test(String(r.Image || '')) ? [[String(r.Image).replace(/^help\//, ''), r.Title]] : [],
    }));
}

const imgSrc = (src) => (/^https:\/\//.test(src) ? helpImageUrl(src) : `help/${src}`);

/** One help item: title opens to the text, steps one per line, and large photos. */
export function helpItem(item, { open = false } = {}) {
  return h('details', { class: 'help-item', id: item.id, open },
    h('summary', {}, item.title),
    item.text ? h('p', { class: 'help-text' }, item.text) : null,
    item.steps ? h('ol', { class: 'help-steps' }, item.steps.map((s) => h('li', {}, s))) : null,
    item.images?.length
      ? h('div', { class: 'help-photos' }, item.images.map(([src, alt]) => h('a', { href: imgSrc(src), target: '_blank', rel: 'noopener' },
        h('img', { class: 'help-photo', src: imgSrc(src), alt, loading: 'lazy' }))))
      : item.category === 'Identification' ? h('p', { class: 'muted small' }, 'Photo to come.') : null);
}

/** All items of a section grouped by category. */
export function helpSection(items) {
  const cats = [...new Set(items.map((i) => i.category))];
  return cats.map((cat) => h('section', { class: 'card' },
    h('h2', {}, cat),
    items.filter((i) => i.category === cat).map((i) => helpItem(i))));
}
