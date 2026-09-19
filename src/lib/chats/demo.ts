import type { Chat, Message } from "./types";

function msg(role: Message["role"], content: string, chat: string, i: number): Message {
  return { id: `demo-${chat}-m-${i}`, role, content };
}

function chat(opts: {
  n: string;
  title: string;
  created: string;
  updated?: string;
  category: Chat["category"];
  pinned?: boolean;
  turns: [string, string][] | [string][];
  extraUser?: string;
}): Chat {
  const messages: Message[] = [];
  let i = 0;
  for (const turn of opts.turns) {
    messages.push(msg("user", turn[0], opts.n, ++i));
    if (turn[1]) messages.push(msg("assistant", turn[1], opts.n, ++i));
  }
  if (opts.extraUser) messages.push(msg("user", opts.extraUser, opts.n, ++i));
  const blob = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join(" ");
  const summary =
    blob.replace(/\s+/g, " ").trim().slice(0, 180) + (blob.length > 180 ? "…" : "");
  return {
    id: `demo-${opts.n}`,
    title: opts.title,
    createdAt: opts.created,
    updatedAt: opts.updated ?? opts.created,
    messages,
    source: "demo",
    status: "active",
    category: opts.category,
    pinned: Boolean(opts.pinned),
    archived: false,
    summary,
  };
}

/** Sample Grok library so analysis is immediately visible. */
export const DEMO_CHATS: Chat[] = [
  chat({
    n: "01",
    title: "Fix TypeScript error in React Query",
    created: "2026-08-18T14:12:00.000Z",
    updated: "2026-08-18T14:40:00.000Z",
    category: "Code",
    pinned: true,
    turns: [
      [
        "I'm getting a TypeScript error with useQuery in React Query v5. The data type is unknown and TError is leaking into my component. Here's the hook: useQuery({ queryKey: ['todos'], queryFn: fetchTodos }). How do I type this cleanly?",
        "Pass a type param to useQuery: useQuery<Todo[]>({ queryKey: ['todos'], queryFn: fetchTodos }). Better: type the queryFn return and let inference work. Also set queryKey as a const tuple. staleTime is independent of gcTime — staleTime controls refetch, gcTime controls cache garbage collection.",
      ],
      [
        "Still seeing 'Property data does not exist on type {}'. Is my QueryClient missing a default?",
        "That usually means the QueryClient generic defaults were overridden or you're importing useQuery from the wrong path. Register the default error type on QueryClient and avoid wrapping the hook in a custom function without forwarding type params.",
      ],
    ],
  }),
  chat({
    n: "02",
    title: "React Query staleTime vs gcTime",
    created: "2026-08-19T09:04:00.000Z",
    category: "Code",
    turns: [
      [
        "Can you explain React Query staleTime vs gcTime? I keep refetching todos with useQuery and TypeScript is also complaining about the data type being unknown.",
        "staleTime: how long data is considered fresh. gcTime: how long inactive cache lives. For todos, staleTime of 30s is common. Type useQuery with the data generic so data is Todo[] instead of unknown.",
      ],
    ],
  }),
  chat({
    n: "03",
    title: "Help with useQuery TypeScript",
    created: "2026-08-20T11:22:00.000Z",
    category: "Code",
    turns: [
      [
        "useQuery typescript error data unknown. React Query v5. queryKey todos queryFn fetchTodos. Please fix.",
        "Add a generic: useQuery<Todo[]>({ queryKey: ['todos'], queryFn: fetchTodos }).",
      ],
    ],
  }),
  chat({
    n: "04",
    title: "hi",
    created: "2026-07-02T08:01:00.000Z",
    category: "Other",
    turns: [["hi"]],
  }),
  chat({
    n: "05",
    title: "test",
    created: "2026-07-02T08:02:00.000Z",
    category: "Other",
    turns: [["test"]],
  }),
  chat({
    n: "06",
    title: "Weekend in Kyoto itinerary",
    created: "2026-08-01T16:00:00.000Z",
    updated: "2026-08-03T10:12:00.000Z",
    category: "Travel",
    pinned: true,
    turns: [
      [
        "Plan a 3-day weekend in Kyoto for two people who like temples, walking, and food. Mid-range budget. We land Friday afternoon and leave Monday morning. Avoid the most overcrowded hours at Fushimi Inari.",
        "Friday: check in near Gion, walk the Shirakawa canal, dinner in Pontocho. Saturday: Arashiyama bamboo early, then Kinkaku-ji, afternoon at Nishiki. Sunday: Fushimi Inari at 6:30am, then Nara if you have energy, or Philosopher's Path. Monday: coffee in a machiya and train to the airport. I'll list restaurants next.",
      ],
      [
        "Swap Nara for more food in Kyoto. Also a rainy-day backup.",
        "Rainy day: Kyoto Railway Museum or a tea ceremony in a machiya, then Nishiki covered arcade. Food: Gyoza no Ohsho for a cheap dinner, Kikunoi if you want one splurge kaiseki, and a breakfast at % Arabica only if the line is short — otherwise a kissaten near your hotel.",
      ],
    ],
  }),
  chat({
    n: "07",
    title: "Kyoto 3-day trip food",
    created: "2026-08-04T19:40:00.000Z",
    category: "Travel",
    turns: [
      [
        "Need food recs for a 3-day Kyoto trip. Temples and walking too. Mid-range. Fushimi Inari early to skip crowds. Any kaiseki that's not insane?",
        "Kikunoi is the splurge. For casual: Nishiki stalls, ramen at Menbaka, and a tofu lunch in Arashiyama. Go to Fushimi Inari at dawn.",
      ],
    ],
  }),
  chat({
    n: "08",
    title: "Explain transformers like I'm 12",
    created: "2026-06-12T13:00:00.000Z",
    category: "Learning",
    turns: [
      [
        "Explain transformers (the neural net, not robots) like I'm 12. I keep seeing attention is all you need.",
        "Imagine reading a sentence and highlighting the words that help you understand the current word. That's attention. A transformer does that in parallel for every word, stacked in layers, which is why it can write and translate so well.",
      ],
    ],
  }),
  chat({
    n: "09",
    title: "Write a resignation letter",
    created: "2026-08-11T07:55:00.000Z",
    category: "Writing",
    turns: [
      [
        "Write a short, warm resignation letter. Two weeks notice. I'm leaving for a role with more design systems work. Keep it gracious, no drama, 180 words max.",
        "Here's a draft: Dear [Manager], I'm writing to resign from my position, effective [date]. I'm grateful for the last [n] years — especially the chance to ship [project]. I've accepted a role focused on design systems. I'll document handoff this week. Thank you. [Name]",
      ],
    ],
  }),
  chat({
    n: "10",
    title: "Debug Docker Desktop on M2 Mac",
    created: "2026-08-15T21:10:00.000Z",
    category: "Support",
    turns: [
      [
        "Docker Desktop on my MacBook Pro M2 is stuck on 'starting' after the latest macOS update. VirtioFS, 8 CPU, 8 GB RAM. Any known fix?",
        "Common after a macOS bump: reset the Docker VM, not the whole app. Quit Docker, then: `rm -rf ~/Library/Group\\ Containers/group.com.docker/settings-store.json` is too aggressive — instead, uncheck VirtioFS, switch to osxfs temporarily, start once, then switch back. Also check that Rosetta is installed if you pull amd64 images. Activity Monitor: if com.docker.virtualization is crashed, reboot once, then 'Troubleshoot → Clean / Purge data' as last resort.",
      ],
    ],
  }),
  chat({
    n: "11",
    title: "Safari PWA — Grok in the Dock",
    created: "2026-08-21T18:05:00.000Z",
    category: "Support",
    turns: [
      [
        "I added Grok to the Dock from Safari on macOS. Is that a real app or a PWA? Can I copy a whole chat out of it?",
        "It's a Safari web app wrapping grok.com. Copy works like the browser: click in the transcript, Cmd+A, Cmd+C. The sidebar is the same as grok.com. There isn't a bulk export yet, so paste chats one at a time or separate them with a line of --- when you drop them into an organizer.",
      ],
    ],
  }),
  chat({
    n: "12",
    title: "Image prompt: misty forest cabin",
    created: "2026-08-08T12:00:00.000Z",
    category: "Creative",
    turns: [
      [
        "Write a tight image prompt: a misty forest cabin at dusk, warm window light, no people, cinematic, still, 35mm.",
        "A small timber cabin in a fog-heavy pine forest at dusk, one window glowing warm tungsten, wet ferns in the foreground, 35mm still photograph, shallow depth of field, no people, quiet cinematic color.",
      ],
    ],
  }),
  chat({
    n: "13",
    title: "Image prompt misty forest cabin dusk",
    created: "2026-08-08T12:18:00.000Z",
    category: "Creative",
    turns: [
      [
        "Need another version of the misty forest cabin at dusk prompt. Warm window light, cinematic 35mm, no people.",
        "Fog between black pines, a cabin with a single lit window, dusk, 35mm, cinematic, no people.",
      ],
    ],
  }),
  chat({
    n: "14",
    title: "Meal prep high protein",
    created: "2026-08-09T15:33:00.000Z",
    category: "Lifestyle",
    turns: [
      [
        "High protein meal prep for a week, I have a job and an M2 laptop, not a lot of kitchen time. No shakes as meals. ~140g protein/day.",
        "Batch: oven chicken thighs, a pot of lentils, Greek yogurt cups, eggs, and a tray of roasted broccoli. Rotate rice and tortillas. That's four dinners and lunches with almost no weeknight cooking.",
      ],
    ],
  }),
  chat({
    n: "15",
    title: "What is the Riemann hypothesis",
    created: "2026-05-20T10:00:00.000Z",
    category: "Research",
    turns: [
      [
        "What is the Riemann hypothesis, in plain language, and why do people care?",
        "It's a claim about where the zeros of the Riemann zeta function sit. If it's true, we get a precise map of how prime numbers are spaced. It's one of the Clay Millennium Problems. The interesting part isn't the prize — it's that a lot of number theory is already written in a form that assumes it's true.",
      ],
    ],
  }),
  chat({
    n: "16",
    title: "ok",
    created: "2026-07-14T22:11:00.000Z",
    category: "Other",
    turns: [["ok"]],
  }),
  chat({
    n: "17",
    title: "Python pandas merge vs join",
    created: "2026-08-16T17:44:00.000Z",
    category: "Code",
    turns: [
      [
        "pandas merge vs join — when do I use each? I have two dataframes of user events and I keep duplicating rows.",
        "join is merge with the index. Prefer merge with explicit on= keys. Duplicated rows mean a many-to-many match — check uniqueness with df.duplicated(subset=['user_id']). Use how='left' and validate='many_to_one' to fail loud.",
      ],
    ],
  }),
  chat({
    n: "18",
    title: "History of typefaces — research notes",
    created: "2026-04-03T09:00:00.000Z",
    updated: "2026-04-11T19:20:00.000Z",
    category: "Research",
    pinned: true,
    turns: [
      [
        "I want a long, structured briefing on the history of typefaces from Gutenberg through Swiss modernism to variable fonts. I care about why certain faces feel 'serious' vs 'friendly', and what to steal for a product UI in 2026.",
        "Start with blackletter vs roman as cultural signals, then Caslon/Baskerville as Enlightenment clarity, then Didot/Bodoni as fashion, then grotesques (Akzidenz, Helvetica) as industrial neutrality. UI in 2026 still borrows that neutrality, then softens it with optical sizes and humanist grotesks (like Figtree or San Francisco). Serif display is back as a way to not look like every SaaS dashboard. I'll go era by era with examples and a short 'steal this' for each.",
      ],
      [
        "Go deeper on grotesque vs humanist sans, and where Instrument Serif sits.",
        "Grotesque: low contrast, closed apertures, 'industrial'. Humanist: some calligraphy in the curves, more friendly. Instrument Serif is a contemporary old-style with sharp digital edges — it reads as editorial, not costume-period. Pair it with a neo-grotesk or geometric-humanist body, keep the serif for titles only.",
      ],
    ],
  }),
  chat({
    n: "19",
    title: "Plan a home gym on a budget",
    created: "2026-08-05T06:30:00.000Z",
    category: "Planning",
    turns: [
      [
        "Home gym on a budget, apartment, MacBook desk in the same room. Don't wreck the floor. Barbell optional.",
        "Adjustable dumbbells, a compact bench, a pull-up bar if the door frame is solid, and a thick mat. Skip the rack until you have a garage. Program: full body 3x/week.",
      ],
    ],
  }),
  chat({
    n: "20",
    title: "Rewrite this email to be warmer",
    created: "2026-08-12T08:10:00.000Z",
    category: "Writing",
    turns: [
      [
        "Rewrite this email to be warmer but still clear. Original: 'Per my last email, I still need the files by Friday or we will miss the launch.' Don't make it fake-cheerful.",
        "Hi — circling back on the files. Friday is the last day we can take them and still hit launch. If anything's blocking you, tell me and I'll help. Thanks.",
      ],
    ],
  }),
  chat({
    n: "21",
    title: "Rewrite this email more professional",
    created: "2026-08-12T08:16:00.000Z",
    category: "Writing",
    turns: [
      [
        "Make this email more professional: 'Per my last email, I still need the files by Friday or we will miss the launch.' Warmer too if possible.",
        "Following up on the files. We need them by Friday to keep the launch date. Happy to help if you're blocked.",
      ],
    ],
  }),
  chat({
    n: "22",
    title: "SwiftUI list performance",
    created: "2026-08-17T13:05:00.000Z",
    category: "Code",
    turns: [
      [
        "SwiftUI List with 2k rows is janky on my M2 Pro. I'm using ForEach with identifiable models. Any real fixes?",
        "Don't nest heavy views in every row. Use List (UITableView-backed) not a VStack in a ScrollView. Equatable rows, avoid AnyView, and load images lazily. Instruments: look for attribute graph invalidation on each scroll tick.",
      ],
    ],
  }),
  chat({
    n: "23",
    title: "Best espresso machine under 500",
    created: "2026-08-06T11:48:00.000Z",
    category: "Lifestyle",
    turns: [
      [
        "Best espresso machine under $500 for a small kitchen. I already have a decent grinder.",
        "Look at a used Gaggia Classic or a new Breville Bambino Plus. The grinder matters more than the boiler. Skip capsules if you already grind.",
      ],
    ],
  }),
  chat({
    n: "24",
    title: "thanks",
    created: "2026-08-18T14:41:00.000Z",
    category: "Other",
    turns: [["thanks"]],
  }),
  chat({
    n: "25",
    title: "Compare Grok vs ChatGPT for coding",
    created: "2026-08-14T20:00:00.000Z",
    category: "Research",
    turns: [
      [
        "Compare Grok vs ChatGPT for coding help. I write TypeScript and some Swift. I care about being current and not overly agreeable.",
        "Grok tends to be more direct and current; ChatGPT is more structured with tools. For TypeScript, both are strong. For 'tell me I'm wrong', Grok is less sycophantic. Use both when the answer is high-stakes.",
      ],
    ],
  }),
  chat({
    n: "26",
    title: "Build a habit tracker spec",
    created: "2026-08-13T09:27:00.000Z",
    category: "Planning",
    turns: [
      [
        "Write a tight product spec for a personal habit tracker. Local first, no account, Mac + phone. I don't want streaks that shame me.",
        "Entities: Habit, Checkin, Note. Views: today, week, archive. No public social. Streaks optional and muted. Data in local storage with a JSON export. That's the whole v1.",
      ],
    ],
  }),
  chat({
    n: "27",
    title: "Vite HMR not updating",
    created: "2026-08-19T16:02:00.000Z",
    category: "Code",
    turns: [
      [
        "Vite HMR isn't updating a TanStack Start route. I change a component and nothing happens until a full reload. Mac, Node 22.",
        "Usually a default export mismatch, or the file isn't part of the graph because of a wrong import path. Also check you're not running Vite directly instead of the project's npm run dev wrapper. Full reload on route files can be expected if the route module itself changed.",
      ],
    ],
  }),
  chat({
    n: "28",
    title: "Explain quantum entanglement",
    created: "2026-03-22T18:40:00.000Z",
    category: "Learning",
    turns: [
      [
        "Explain quantum entanglement without the usual pop-science handwaving. I know basic linear algebra.",
        "A composite system in a state that cannot be written as a tensor product of subsystem states. Measurement correlations are stronger than any local hidden variable model allows (Bell). No faster-than-light signaling: reduced density matrices look mixed, and you can't choose the outcome.",
      ],
    ],
  }),
];
