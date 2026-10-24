import { Field } from "@/shared/ui/Field.jsx";
import { TimeInput } from "@/shared/ui/TimeInput.jsx";

export function TimeField({ label, value, onChange, onBlur }) {
  return (
    <Field label={label}>
      <TimeInput value={value} onValueChange={onChange} onBlur={onBlur} />
    </Field>
  );
}
