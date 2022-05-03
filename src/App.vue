<script setup>
import FetchForm from './components/FetchForm.vue'
</script>

<template>
  <header>🚦 Traffic Advice Checkup</header>
  <FetchForm />
</template>

<style>
@import './assets/base.css';

#app {
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem;
}

header {
  font-size: 2em;
  text-align: center;
  margin-bottom: 1em;
}

@media (max-width: 500px) {
  header { font-size: 1.5em; }
}
</style>
