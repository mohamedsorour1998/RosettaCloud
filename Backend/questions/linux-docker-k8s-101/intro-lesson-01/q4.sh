#!/bin/bash

# Question Number: 4
# Question: Which command shows real-time CPU and memory usage in a terminal?
# Question Type: MCQ
# Question Difficulty: Easy
# Possible answers:
# - answer_1: top
# - answer_2: touch
# - answer_3: gzip
# - answer_4: diff
# Correct answer: answer_1

# -q flag: no setup needed
if [[ "$1" == "-q" ]]; then
  echo "No setup required for this MCQ."
  exit 0
fi

# -c flag: always succeed
if [[ "$1" == "-c" ]]; then
  echo "Nothing to verify for this MCQ."
  exit 0
fi
