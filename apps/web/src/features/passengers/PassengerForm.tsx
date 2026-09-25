import { zodResolver } from "@hookform/resolvers/zod";
import {
  BERTH_LABELS,
  BERTH_PREFERENCES,
  FOOD_LABELS,
  FOOD_PREFERENCES,
  GENDER_LABELS,
  GENDERS,
  passengerInputSchema,
  type PassengerDto,
} from "@tatkalflow/shared";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
import { Banner, Button, Field, Input, Segmented, Switch } from "../../components/ui";
import { ApiError } from "../../lib/api";
import { useCreatePassenger, useUpdatePassenger } from "../../lib/queries";

type FormIn = z.input<typeof passengerInputSchema>;
type FormOut = z.output<typeof passengerInputSchema>;

const opts = <T extends string>(values: readonly T[], labels: Record<T, string>) => values.map((v) => ({ value: v, label: labels[v] }));

export function PassengerForm({ existing, submitLabel = "Save passenger", onSaved }: { existing?: PassengerDto; submitLabel?: string; onSaved: (p: PassengerDto) => void }) {
  const create = useCreatePassenger();
  const update = useUpdatePassenger(existing?.id ?? "");
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, control, handleSubmit, watch, setError, formState } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(passengerInputSchema),
    defaultValues: existing
      ? {
          name: existing.name,
          age: existing.age,
          gender: existing.gender,
          berthPreference: existing.berthPreference,
          foodPreference: existing.foodPreference,
          seniorCitizenOptIn: existing.seniorCitizenOptIn,
          childBerthOptIn: existing.childBerthOptIn,
        }
      : { berthPreference: "NO_PREFERENCE", foodPreference: "NO_PREFERENCE", seniorCitizenOptIn: false, childBerthOptIn: true },
  });
  const age = Number(watch("age"));
  const errors = formState.errors;

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const saved = existing ? await update.mutateAsync(values) : await create.mutateAsync(values);
      onSaved(saved);
    } catch (e) {
      if (e instanceof ApiError) {
        for (const f of e.fields) if (f.path in values) setError(f.path as keyof FormIn, { message: f.message });
        setServerError(e.fields.length ? null : e.message);
      } else setServerError("Couldn't save. Please try again.");
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <Field label="Full name" htmlFor="p-name" error={errors.name?.message} hint="As on the ID the passenger will carry">
        <Input id="p-name" autoComplete="off" invalid={Boolean(errors.name)} {...register("name")} />
      </Field>
      <Field label="Age" htmlFor="p-age" error={errors.age?.message}>
        <Input id="p-age" type="number" inputMode="numeric" min={0} max={125} className="max-w-32" invalid={Boolean(errors.age)} {...register("age")} />
      </Field>
      <Controller
        control={control}
        name="gender"
        render={({ field }) => (
          <Segmented label="Gender" name="gender" value={field.value} onChange={field.onChange} options={opts(GENDERS, GENDER_LABELS)} error={errors.gender?.message} />
        )}
      />
      <Controller
        control={control}
        name="berthPreference"
        render={({ field }) => (
          <Segmented label="Berth preference" name="berth" value={field.value} onChange={field.onChange} options={opts(BERTH_PREFERENCES, BERTH_LABELS)} />
        )}
      />
      <Controller
        control={control}
        name="foodPreference"
        render={({ field }) => (
          <Segmented label="Food preference (where meals are offered)" name="food" value={field.value} onChange={field.onChange} options={opts(FOOD_PREFERENCES, FOOD_LABELS)} />
        )}
      />
      <div className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-4">
        <Controller
          control={control}
          name="seniorCitizenOptIn"
          render={({ field }) => (
            <Switch
              label="Claim senior-citizen benefits where available"
              description="Applied only if the rules for that booking allow it. Eligibility is checked at booking time."
              checked={Boolean(field.value)}
              onChange={field.onChange}
            />
          )}
        />
        {Number.isFinite(age) && age < 18 && (
          <Controller
            control={control}
            name="childBerthOptIn"
            render={({ field }) => (
              <Switch
                label="Book a full berth for this child"
                description="Used where the railway offers a choice for children."
                checked={Boolean(field.value)}
                onChange={field.onChange}
              />
            )}
          />
        )}
      </div>
      <p className="text-xs text-muted">No ID document details are collected.</p>
      {serverError && <Banner tone="danger">{serverError}</Banner>}
      <Button type="submit" block loading={formState.isSubmitting}>
        {submitLabel}
      </Button>
    </form>
  );
}
