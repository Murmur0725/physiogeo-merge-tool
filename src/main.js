import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import App from "./App.vue";
import MergeView from "./views/MergeView.vue";
import ReviewView from "./views/ReviewView.vue";
import "./style.css";

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: "/", name: "merge", component: MergeView },
    { path: "/review", name: "review", component: ReviewView },
    { path: "/:pathMatch(.*)*", redirect: "/" }
  ]
});

createApp(App).use(router).mount("#app");
