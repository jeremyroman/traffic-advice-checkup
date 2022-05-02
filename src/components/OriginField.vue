<script setup>
const props = defineProps(["modelValue"]);
const emit = defineEmits(["update:modelValue"]);

function emitValue(e) {
  try {
    let value = e.target.value;
    if (!/^[A-Za-z]+:/.test(value))
      value = 'https://' + value;
    value = new URL(value).origin;
    if (value !== 'null') {
      e.target.value = value;
    }
  } catch (err) {}
  emit("update:modelValue", e.target.value);
}
</script>

<template>
  <input :value="modelValue" @change="emitValue">
</template>
