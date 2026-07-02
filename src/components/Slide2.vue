<template>
  <div class="slide-wrapper">
    <div class="navbar">
      <h2 class="navbar-title">{{ topic }}</h2>
      <img src="../assets/logo.png" />
    </div>
    <div class="slide-body">
      <div class="row-main">
        <slot name="content" /> <!-- html code here-->
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  topic: {
    type: String,
    required: true,
  },
  subTopic: {
    type: String,
    default: '',
  }
});
</script>

<style scoped>

.slide-wrapper {
  margin-top: -10px;
  margin-left: -30px;
  width: 107%;
  height: 100%;
  font-size: 0.8rem;
  font-weight: 400;
  /* background-color: #5f87c7; */
}
.slide-body {
  display: flex;
  flex-direction: column;
  border-radius: 4px;
  height: 100%;
}

.cont {
  background-color: #ef5050;
}

.navbar {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  padding: 0 10px;
  background-color: #ffffff;
  position: fixed;
  width: 94.7%;
}

.navbar > img {
  height: 30px;
}

.navbar-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
  background-color: #ef5050;
  color: #ffffff;
  width: 80%;
  padding-left: 10px;
  margin-left: -10px;
  border-radius: 5px;
}
.row-main {
  width: 100%;
  height: 90%;
  margin-top: 45px;
  overflow-x: auto;
  overflow-y: auto;
  scrollbar-width:none;

  overflow-x: auto;
  overflow-y: auto;
  scrollbar-width:thin;
}
</style>