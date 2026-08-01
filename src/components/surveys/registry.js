import PssSurvey from "./PssSurvey.vue";
import PomsSfSurvey from "./PomsSfSurvey.vue";
import RosSurvey from "./RosSurvey.vue";
import CustomEvalSurvey from "./CustomEvalSurvey.vue";
import PretestSurvey from "./PretestSurvey.vue";

export const SURVEY_REGISTRY = {
  pretest: {
    id: "pretest",
    label: "Pre-test (GAD-7 + POMS-30)",
    component: PretestSurvey
  },
  posttest: {
    id: "posttest",
    label: "Post-test (POMS-30)",
    component: PomsSfSurvey
  },
  pomsSf: {
    id: "pomsSf",
    label: "POMS-30",
    component: PomsSfSurvey
  },
  pss: {
    id: "pss",
    label: "PSS (Perceived Stress Scale)",
    component: PssSurvey
  },
  ros: {
    id: "ros",
    label: "ROS (Restoration Outcome Scale)",
    component: RosSurvey
  },
  customEval: {
    id: "customEval",
    label: "Custom Evaluation",
    component: CustomEvalSurvey
  }
};

export function resolveSurvey(instrumentId) {
  return SURVEY_REGISTRY[instrumentId] || SURVEY_REGISTRY.posttest;
}
