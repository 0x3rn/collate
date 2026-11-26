"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useToast } from "@/components/ui/toast";

/**
 * Shows the result of a checkout (from the ?payment= return parameter) as a toast, then removes
 * the parameter so a page refresh does not show it again.
 */
export function PaymentStatusToast({ payment }: { payment?: string }) {
  const toast = useToast();
  const router = useRouter();
  const shown = useRef(false);

  useEffect(() => {
    if (!payment || shown.current) return;
    shown.current = true;
    if (payment === "success" || payment === "polar_success" || payment === "stripe_success") {
      toast.success(
        "Your new credits will appear in your balance within a few seconds. Refresh if they have not updated.",
        "Payment received"
      );
    } else if (payment === "pending" || payment === "paystack_pending") {
      toast.info(
        "Your credits are added automatically as soon as the payment is confirmed.",
        "Payment submitted"
      );
    } else if (
      payment === "cancelled" ||
      payment === "polar_cancelled" ||
      payment === "stripe_cancelled"
    ) {
      toast.info("No charge was made to your payment method.", "Checkout cancelled");
    } else {
      return;
    }
    router.replace("/billing", { scroll: false });
  }, [payment, router, toast]);

  return null;
}
