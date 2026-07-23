import type { Candidate } from "../types";
import { CandidateList } from "./CandidateList";
import { CandidateShow } from "./CandidateShow";

export default {
  list: CandidateList,
  show: CandidateShow,
  recordRepresentation: (record: Candidate) =>
    [record?.first_name, record?.last_name].filter(Boolean).join(" ") ||
    "Candidate",
};
