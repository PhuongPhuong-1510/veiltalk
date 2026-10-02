# Hand evidence for hidden-elbow branch selection

## Implemented behavior

- With a valid shoulder and wrist but an untrusted elbow, the solver builds the two-bone elbow circle. It scores the exact continuation pole plus 24 evenly spaced candidates and four local refinements.
- The Hand longitudinal image axis is taken from the existing palm basis. It is matched to the correct arm and accepted only while its timestamp is close to the Pose sample. Candidate forearms are projected into the same aspect-corrected image space before comparison.
- The Hand penalty has a 60° wrist-bend tolerance. History, anatomy, face clearance and rig collision remain separate score terms. Deep head penetration invalidates only a challenger; intentional face contact is exempt.
- A challenger must beat the current branch by 0.25 score, separate by at least 30° in the image, and win on three distinct Hand sample timestamps. The elbow circle radius must be at least 12% of the shorter bone. The observed-elbow anchor is updated only by a trusted Pose elbow.
- A confirmed switch triggers a 350 ms arm recovery blend. The switch toggle resets pending evidence. With the toggle off, candidate scores remain visible while output follows the continuation branch.

## Webcam acceptance on `/dev/avatar-renderer`

Enable tracking and use **Hand elbow branch switch (A/B)**. Compare the same gestures with the toggle off and on. The arm diagnostic shows candidate count, `branch` (`current`, `pending`, `switched`, `unobservable` or `no-hand`), pending sample count, score margin and image separation.

1. Raise each arm with the elbow briefly outside the frame while keeping shoulder, wrist and Hand visible. A wrong continuation branch should change only after `pending` reaches three distinct Hand observations. The visible arm should transition smoothly, without a sudden elbow flip.
2. Hold the forearm still and flex/extend the wrist through a large but comfortable range. The elbow should not change sides solely because the hand bends. Repeat with Hand twist disabled.
3. Point the arm toward the camera and then nearly straighten it. The diagnostic should report `unobservable` or keep `current`; the elbow should not alternate sides as tracking jitters.
4. Move the hand beside the face without touching, then intentionally touch the face. The arm should not cross through the head; intentional contact should remain possible.
5. Let the Hand detector miss briefly and return; then test two hands close together. A stale, duplicate or incorrectly matched Hand observation must not increment the pending count.
6. Repeat with the switch toggle off. Candidate scores should still appear, but the hidden-elbow branch should follow the previous behavior.

Record any incorrect switch with the arm diagnostic, source timestamps, and the gesture that produced it. Automated tests cover deterministic geometry and sample counting; these webcam observations are the final acceptance gate.
