// Wraps page content in the shared hero treatment.
import "./HeroSection.css";

function HeroSection({ children }) {
  return (
    // Shared hero wrapper used accross pagees so the background treatment
    // stays separate from the page-specific headline and CTA content.
    <section className="heroSection">
      <div className="heroSectionInner">{children}</div>
    </section>
  );
}

export default HeroSection;
