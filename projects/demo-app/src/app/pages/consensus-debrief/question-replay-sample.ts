/** Illustrative dialogue for the question-card demo; these are not model responses. */
export const QUESTION_REPLAY_SAMPLE = {
  "question": "Illustrative sample: when should source code have comments?",
  "participants": ["Luna (sample)", "Haiku (sample)"],
  "turns": [
    {"round":1,"participant":"Luna (sample)","action":"speak","speech":"Comments can preserve the reasoning that the code cannot show.","readiness":"discussing","agreement":{},"questions":[{"id":"Q1","to":"Haiku (sample)","question":"How can we tell which decisions need a comment?"},{"id":"Q2","to":"Haiku (sample)","question":"Should every function have one?"}],"responses":[]},
    {"round":1,"participant":"Haiku (sample)","action":"speak","speech":"A comment is useful when it records a constraint or tradeoff a future reader could miss.","readiness":"discussing","agreement":{},"questions":[],"responses":[{"id":"Q1","status":"answered"}]},
    {"round":2,"participant":"Haiku (sample)","action":"speak","speech":"I cannot give a blanket rule for every function yet.","readiness":"discussing","agreement":{},"questions":[],"responses":[{"id":"Q2","status":"declined"}]}
  ]
};
