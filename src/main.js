import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import App from "./App.vue";
import MergeView from "./views/MergeView.vue";
import PlaceholderView from "./views/PlaceholderView.vue";
import "./style.css";

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: "/", name: "merge", component: MergeView },
    { path: "/map", name: "map", component: PlaceholderView, meta: { title: "Map View" } },
    { path: "/streetview", name: "streetview", component: PlaceholderView, meta: { title: "Street View" } },
    { path: "/survey", name: "survey", component: PlaceholderView, meta: { title: "Survey" } }
  ]
});

createApp(App).use(router).mount("#app");
