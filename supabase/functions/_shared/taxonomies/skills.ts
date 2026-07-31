// Skills taxonomy — alias table for skill normalization.
//
// No Deno-specific imports — Vitest-compatible.
//
// Skills are open-ended (unlike seniority/location which are closed vocabularies),
// so we don't pre-populate a full skills ontology. Instead:
//   - Any skill that passes normalizeSkillTokens still becomes a chip.
//   - If it doesn't resolve here, it's logged to unresolved_taxonomy_terms.
//   - A weekly review of that table promotes recurring terms into this alias table.
//
// This converts "a skill got mangled in this JD" from a code-review finding
// into a data-entry task — which is the whole point of table-driven lookups.

export type CanonicalSkill = string; // open-ended; canonical = normalized form

// Maps known alias → canonical skill name.
// Seeded from common tech-skill shorthands. Grows from unresolved_taxonomy_terms
// review cycles — NOT by adding compiler if-branches.
export const SKILL_ALIASES: Record<string, CanonicalSkill> = {
  // Languages
  js: "JavaScript",
  javascript: "JavaScript",
  "java script": "JavaScript",
  ts: "TypeScript",
  typescript: "TypeScript",
  py: "Python",
  python: "Python",
  rb: "Ruby",
  ruby: "Ruby",
  "c#": "C#",
  csharp: "C#",
  "c sharp": "C#",
  "c++": "C++",
  cpp: "C++",
  golang: "Go",
  go: "Go",
  rust: "Rust",
  java: "Java",
  scala: "Scala",
  kotlin: "Kotlin",
  swift: "Swift",
  "objective-c": "Objective-C",
  objc: "Objective-C",
  php: "PHP",
  perl: "Perl",
  r: "R",

  // Frontend
  react: "React",
  "react.js": "React",
  reactjs: "React",
  "react native": "React Native",
  vue: "Vue.js",
  "vue.js": "Vue.js",
  vuejs: "Vue.js",
  angular: "Angular",
  svelte: "Svelte",
  nextjs: "Next.js",
  "next.js": "Next.js",
  nuxt: "Nuxt.js",
  "nuxt.js": "Nuxt.js",
  css: "CSS",
  scss: "SCSS",
  tailwind: "Tailwind CSS",
  "tailwind css": "Tailwind CSS",

  // Backend / infra
  node: "Node.js",
  nodejs: "Node.js",
  "node.js": "Node.js",
  express: "Express.js",
  "express.js": "Express.js",
  django: "Django",
  flask: "Flask",
  rails: "Ruby on Rails",
  "ruby on rails": "Ruby on Rails",
  spring: "Spring",
  "spring boot": "Spring Boot",
  fastapi: "FastAPI",

  // Cloud / devops
  aws: "AWS",
  "amazon web services": "AWS",
  gcp: "GCP",
  "google cloud": "GCP",
  "google cloud platform": "GCP",
  azure: "Azure",
  "microsoft azure": "Azure",
  k8s: "Kubernetes",
  kubernetes: "Kubernetes",
  docker: "Docker",
  terraform: "Terraform",
  ci: "CI/CD",
  "ci/cd": "CI/CD",
  "continuous integration": "CI/CD",

  // Data / ML
  pytorch: "PyTorch",
  torch: "PyTorch",
  tensorflow: "TensorFlow",
  tf: "TensorFlow",
  sklearn: "scikit-learn",
  "scikit-learn": "scikit-learn",
  "scikit learn": "scikit-learn",
  pandas: "pandas",
  numpy: "NumPy",
  ml: "Machine Learning",
  "machine learning": "Machine Learning",
  "deep learning": "Deep Learning",
  llm: "LLM",
  "large language model": "LLM",
  rag: "RAG",
  "retrieval augmented generation": "RAG",
  nlp: "NLP",
  "natural language processing": "NLP",

  // Databases
  postgres: "PostgreSQL",
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  mongodb: "MongoDB",
  mongo: "MongoDB",
  redis: "Redis",
  elasticsearch: "Elasticsearch",
  es: "Elasticsearch",

  // Security
  soc2: "SOC 2",
  "soc 2": "SOC 2",
  soc2type2: "SOC 2",
  "iso 27001": "ISO 27001",
  gdpr: "GDPR",
  siem: "SIEM",
  splunk: "Splunk",
  crowdstrike: "CrowdStrike",
  "threat hunting": "Threat Hunting",

  // Misc common shorthands
  api: "API",
  rest: "REST",
  restful: "REST",
  graphql: "GraphQL",
  grpc: "gRPC",
  sql: "SQL",
  nosql: "NoSQL",
  microservices: "Microservices",
  "micro-services": "Microservices",
  agile: "Agile",
  scrum: "Scrum",
};

/**
 * Resolve a raw skill token to a canonical skill name.
 *
 * Returns null when the token is unrecognized — caller logs it and still
 * creates a chip (skills are open-ended, unlike seniority/location).
 */
export function resolveSkill(raw: string): CanonicalSkill | null {
  const key = raw.trim().toLowerCase();
  return SKILL_ALIASES[key] ?? null;
}
