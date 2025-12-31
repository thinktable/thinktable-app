import { ShapeComponents, type ShapeComponentProps } from './types';

function Shape({ type, width, height, className, ...svgAttributes }: ShapeComponentProps) {
  const ShapeComponent = ShapeComponents[type];

  if (!ShapeComponent || !width || !height) {
    return null;
  }

  const strokeWidth = svgAttributes.strokeWidth
    ? +svgAttributes.strokeWidth
    : 0;

  // we subtract the strokeWidth to make sure the shape is not cut off
  // this is done because svg doesn't support stroke inset (https://stackoverflow.com/questions/7241393/can-you-control-how-an-svgs-stroke-width-is-drawn)
  const innerWidth = width - 2 * strokeWidth;
  const innerHeight = height - 2 * strokeWidth;

  return (
    <svg 
      width="100%" 
      height="100%" 
      className={className || 'shape-svg'} 
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ display: 'block' }}
    >
      {/* this offsets the shape by the strokeWidth so that we have enough space for the stroke */}
      <g
        transform={`translate(${svgAttributes.strokeWidth ?? 0}, ${
          svgAttributes.strokeWidth ?? 0
        })`}
      >
        <ShapeComponent
          width={innerWidth}
          height={innerHeight}
          {...svgAttributes}
        />
      </g>
    </svg>
  );
}

export default Shape;

