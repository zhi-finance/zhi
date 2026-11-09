import { Hero } from "@/components/home/hero";
import { Playground } from "@/components/home/playground";
import { Capital, Faq, FinalCta, LiveProof, RuleLives } from "@/components/home/sections";
import { Verbs } from "@/components/home/verbs";

export default function Home() {
  return (
    <>
      <Hero />
      <Verbs />
      <Playground />
      <RuleLives />
      <LiveProof />
      <Capital />
      <Faq />
      <FinalCta />
    </>
  );
}
