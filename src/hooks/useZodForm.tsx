"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  type FieldValues,
  type Resolver,
  type UseFormProps,
  type UseFormReturn,
  useForm,
} from "react-hook-form";
import type { z } from "zod";

/**
 * Thin wrapper over react-hook-form's useForm that takes a Zod `schema` and
 * auto-applies the resolver, returning a properly typed form. Use with
 * `useAction` for forms where the form shape matches the action input.
 */
export function useZodForm<TSchema extends z.ZodType<FieldValues>>({
  schema,
  ...formProps
}: Omit<UseFormProps<z.infer<TSchema>>, "resolver"> & {
  schema: TSchema;
}): UseFormReturn<z.infer<TSchema>> {
  return useForm<z.infer<TSchema>>({
    ...formProps,
    // Cast bridges Zod 4 internals and the resolver's overloads; runtime is correct.
    resolver: zodResolver(schema as never) as unknown as Resolver<
      z.infer<TSchema>
    >,
  });
}
