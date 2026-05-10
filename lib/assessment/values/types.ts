export type ValueOption = {
  id: string;
  label_he: string;
  description_he: string;
};

export type ValuesSubmission = {
  picked: string[];   // 5 ids
  ranked: string[];   // first 3 ids of `picked` in priority order
};

export type ValuesScores = {
  topThree: string[];          // ranked top-3 ids, ordered
  alsoPicked: string[];        // ids 4-5 from picked, unordered
};
