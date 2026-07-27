import PssSurvey from "./PssSurvey.vue";
import PomsSfSurvey from "./PomsSfSurvey.vue";
import RosSurvey from "./RosSurvey.vue";
import CustomEvalSurvey from "./CustomEvalSurvey.vue";

export const SURVEY_REGISTRY = {
  pss: {
    id: "pss",
    label: "PSS (Perceived Stress Scale)",
    component: PssSurvey
  },
  pomsSf: {
    id: "pomsSf",
    label: "POMS-SF",
    component: PomsSfSurvey
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
  return SURVEY_REGISTRY[instrumentId] || SURVEY_REGISTRY.customEval;
}
